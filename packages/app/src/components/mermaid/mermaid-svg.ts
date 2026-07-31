const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const REFERENCE_ATTRIBUTES = new Set(["href", "src", "xlink:href"]);
const PROHIBITED_ELEMENTS = new Set(["embed", "foreignobject", "iframe", "object", "script"]);

function containsUnsafeStyle(value: string): boolean {
  if (/@import|javascript:|expression\s*\(/i.test(value)) return true;

  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  let urlCount = 0;
  while ((match = urlPattern.exec(value))) {
    urlCount += 1;
    if (!match[2]?.trim().startsWith("#")) return true;
  }

  return (value.match(/url\s*\(/gi)?.length ?? 0) !== urlCount;
}

export function parseAndValidateMermaidSvg(svg: string): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = svg;

  const root = template.content.firstElementChild;
  if (
    template.content.childElementCount !== 1 ||
    root?.namespaceURI !== SVG_NAMESPACE ||
    root.localName !== "svg"
  ) {
    throw new Error("Mermaid output must have exactly one SVG root");
  }

  const descendants = [...root.querySelectorAll("*")];
  if (descendants.some((element) => PROHIBITED_ELEMENTS.has(element.localName.toLowerCase()))) {
    throw new Error("Mermaid SVG contains a prohibited element");
  }

  if (
    descendants.some(
      (element) =>
        element.localName.toLowerCase() === "style" &&
        containsUnsafeStyle(element.textContent ?? ""),
    )
  ) {
    throw new Error("Mermaid SVG contains an unsafe style");
  }

  for (const element of [root, ...descendants]) {
    for (const attribute of element.attributes) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        throw new Error("Mermaid SVG contains an event handler attribute");
      }
      if (attribute.name.toLowerCase() === "style" && containsUnsafeStyle(attribute.value)) {
        throw new Error("Mermaid SVG contains an unsafe style");
      }
      if (!REFERENCE_ATTRIBUTES.has(attribute.name.toLowerCase())) continue;
      const value = attribute.value.trim();
      if (value && !value.startsWith("#")) {
        throw new Error("Mermaid SVG contains an external reference");
      }
    }
  }

  return root as SVGSVGElement;
}
