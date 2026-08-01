import { useRef } from "react";
import { FlatList, Image, Pressable, ScrollView, Text, View } from "react-native";

export interface SharedValue<T> {
  value: T;
  get: () => T;
  set: (value: T | ((current: T) => T)) => void;
  modify: (modifier?: (current: T) => T) => void;
}

function createSharedValue<T>(initialValue: T): SharedValue<T> {
  const sharedValue: SharedValue<T> = {
    value: initialValue,
    get: () => sharedValue.value,
    set: (value) => {
      sharedValue.value =
        typeof value === "function" ? (value as (current: T) => T)(sharedValue.value) : value;
    },
    modify: (modifier) => {
      if (modifier) sharedValue.value = modifier(sharedValue.value);
    },
  };
  return sharedValue;
}

const layoutAnimation = {
  delay: () => layoutAnimation,
  duration: () => layoutAnimation,
  easing: () => layoutAnimation,
  springify: () => layoutAnimation,
  withCallback: () => layoutAnimation,
};

export const FadeIn = layoutAnimation;
export const FadeOut = layoutAnimation;

export class Keyframe {
  duration(_durationMs: number): this {
    return this;
  }
}

export const Easing = {
  linear: (value: number) => value,
  ease: (value: number) => value,
  quad: (value: number) => value * value,
  exp: (value: number) => 2 ** (10 * (value - 1)),
  in: (easing: (value: number) => number) => easing,
  out: (easing: (value: number) => number) => (value: number) => 1 - easing(1 - value),
  inOut: (easing: (value: number) => number) => easing,
};

export const Extrapolation = { CLAMP: "clamp", EXTEND: "extend", IDENTITY: "identity" } as const;
export const ReduceMotion = { System: "system", Always: "always", Never: "never" } as const;

export function useSharedValue<T>(initialValue: T): SharedValue<T> {
  return useRef(createSharedValue(initialValue)).current;
}

export function makeMutable<T>(initialValue: T): SharedValue<T> {
  return createSharedValue(initialValue);
}

export function useDerivedValue<T>(updater: () => T): SharedValue<T> {
  const value = useSharedValue(updater());
  value.value = updater();
  return value;
}

export function useAnimatedStyle<T>(updater: () => T): T {
  return updater();
}

export function useAnimatedProps<T>(updater: () => T): T {
  return updater();
}

export function useAnimatedReaction<T>(
  _prepare: () => T,
  _react: (current: T, previous: T | null) => void,
): void {}

export function useAnimatedRef<T>(): { current: T | null } {
  return useRef<T | null>(null);
}

export function useAnimatedScrollHandler<T>(handlers: T): T {
  return handlers;
}

export function useReducedMotion(): boolean {
  return false;
}

export function runOnJS<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  return callback;
}

export function runOnUI<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  return callback;
}

export function withSpring<T>(toValue: T): T {
  return toValue;
}

export function withTiming<T>(toValue: T): T {
  return toValue;
}

export function withRepeat<T>(animation: T): T {
  return animation;
}

export function withSequence<T>(...animations: T[]): T | undefined {
  return animations.at(-1);
}

export function interpolate(_value: number, _input: number[], output: number[]): number {
  return output[0] ?? 0;
}

export function interpolateColor(_value: number, _input: number[], output: string[]): string {
  return output[0] ?? "transparent";
}

export function cancelAnimation(_value: SharedValue<unknown>): void {}
export function scrollTo(..._args: unknown[]): void {}

const Animated = {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  FlatList,
  addWhitelistedUIProps: () => {},
  createAnimatedComponent: <T>(component: T): T => component,
};

export default Animated;
