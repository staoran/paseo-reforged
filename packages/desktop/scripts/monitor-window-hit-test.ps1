param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [Parameter(Mandatory = $true)]
    [int]$ClientX,
    [Parameter(Mandatory = $true)]
    [string]$StopFile,
    [int]$TopClientY = 2,
    [int]$UpperClientY = 22,
    [int]$LowerClientY = 60,
    [int]$MaximumDurationMs = 60000
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class PaseoWindowHitTestNative
{
    // Win32 point used to convert client coordinates to screen coordinates.
    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }

    // Win32 rectangle used to validate sample coordinates.
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    // Converts a client point before WM_NCHITTEST packs it into LPARAM.
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ClientToScreen(IntPtr window, ref Point point);

    // Reads the current native client bounds.
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetClientRect(IntPtr window, out Rect rect);

    // Rejects a stale Electron process or an invalid main-window handle.
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr window);

    // Sends the external WM_NCHITTEST observation to the real BrowserWindow.
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
"@

# WM_NCHITTEST asks the native window which chrome behavior owns a screen point.
$WindowHitTestMessage = 0x0084
# These two results form the exact intermittent dead-zone signature under test.
$HitClient = 1
$HitCaption = 2

# Packs one screen point using WM_NCHITTEST's signed 16-bit coordinate layout.
function ConvertTo-HitTestLParam {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ScreenX,
        [Parameter(Mandatory = $true)]
        [int]$ScreenY
    )

    $packedPoint = (($ScreenY -band 0xffff) -shl 16) -bor ($ScreenX -band 0xffff)
    return [IntPtr]::new([int64]$packedPoint)
}

# Samples one BrowserWindow client coordinate through User32.
function Invoke-WindowHitTest {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$WindowHandle,
        [Parameter(Mandatory = $true)]
        [int]$X,
        [Parameter(Mandatory = $true)]
        [int]$Y
    )

    $screenPoint = [PaseoWindowHitTestNative+Point]::new()
    $screenPoint.X = $X
    $screenPoint.Y = $Y
    if (-not [PaseoWindowHitTestNative]::ClientToScreen($WindowHandle, [ref]$screenPoint)) {
        throw "ClientToScreen failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $messagePoint = ConvertTo-HitTestLParam -ScreenX $screenPoint.X -ScreenY $screenPoint.Y
    return [int][PaseoWindowHitTestNative]::SendMessage(
        $WindowHandle,
        $WindowHitTestMessage,
        [IntPtr]::Zero,
        $messagePoint
    ).ToInt64()
}

# Records a native hit-test result without assuming which transient states will occur.
function Add-HitTestCount {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Histogram,
        [Parameter(Mandatory = $true)]
        [int]$HitTest
    )

    $key = [string]$HitTest
    if (-not $Histogram.ContainsKey($key)) {
        $Histogram[$key] = 0
    }
    $Histogram[$key] += 1
}

$targetProcess = Get-Process -Id $ProcessId -ErrorAction Stop
$windowHandle = $targetProcess.MainWindowHandle
if ($windowHandle -eq [IntPtr]::Zero -or -not [PaseoWindowHitTestNative]::IsWindow($windowHandle)) {
    throw "Process $ProcessId does not own a valid main window"
}

$clientRect = [PaseoWindowHitTestNative+Rect]::new()
if (-not [PaseoWindowHitTestNative]::GetClientRect($windowHandle, [ref]$clientRect)) {
    throw "GetClientRect failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
$clientWidth = $clientRect.Right - $clientRect.Left
$clientHeight = $clientRect.Bottom - $clientRect.Top
if (
    $ClientX -lt 0 -or $ClientX -ge $clientWidth -or
    $TopClientY -lt 0 -or $TopClientY -ge $clientHeight -or
    $UpperClientY -lt 0 -or $UpperClientY -ge $clientHeight -or
    $LowerClientY -lt 0 -or $LowerClientY -ge $clientHeight
) {
    throw "Sample points ($ClientX,$TopClientY/$UpperClientY/$LowerClientY) are outside client size ${clientWidth}x${clientHeight}"
}

$topHistogram = @{}
$upperHistogram = @{}
$lowerHistogram = @{}
$sampleCount = 0
$deadZoneCount = 0
$firstDeadZone = $null
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
if (Test-Path -LiteralPath $StopFile) {
    throw "Stop file already exists: $StopFile"
}

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while (-not (Test-Path -LiteralPath $StopFile) -and $stopwatch.ElapsedMilliseconds -lt $MaximumDurationMs) {
    $topHit = Invoke-WindowHitTest -WindowHandle $windowHandle -X $ClientX -Y $TopClientY
    $upperHit = Invoke-WindowHitTest -WindowHandle $windowHandle -X $ClientX -Y $UpperClientY
    $lowerHit = Invoke-WindowHitTest -WindowHandle $windowHandle -X $ClientX -Y $LowerClientY
    Add-HitTestCount -Histogram $topHistogram -HitTest $topHit
    Add-HitTestCount -Histogram $upperHistogram -HitTest $upperHit
    Add-HitTestCount -Histogram $lowerHistogram -HitTest $lowerHit
    $sampleCount += 1

    if ($upperHit -eq $HitClient -and $lowerHit -eq $HitCaption) {
        $deadZoneCount += 1
        if ($null -eq $firstDeadZone) {
            $firstDeadZone = [ordered]@{
                elapsedMs = $stopwatch.Elapsed.TotalMilliseconds
                upperHit = $upperHit
                lowerHit = $lowerHit
            }
        }
    }
}

$stopwatch.Stop()
$timedOut = -not (Test-Path -LiteralPath $StopFile)
$result = [ordered]@{
    processId = $ProcessId
    windowHandle = $windowHandle.ToInt64()
    clientSize = [ordered]@{ width = $clientWidth; height = $clientHeight }
    samplePoint = [ordered]@{
        x = $ClientX
        topY = $TopClientY
        upperY = $UpperClientY
        lowerY = $LowerClientY
    }
    durationMs = $stopwatch.Elapsed.TotalMilliseconds
    timedOut = $timedOut
    sampleCount = $sampleCount
    deadZoneCount = $deadZoneCount
    firstDeadZone = $firstDeadZone
    topHistogram = $topHistogram
    upperHistogram = $upperHistogram
    lowerHistogram = $lowerHistogram
}

[Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
[Console]::Out.Flush()
