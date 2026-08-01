// @ts-expect-error react-native-web does not publish declarations for its runtime entrypoint.
export * from "react-native-web";

export const ToastAndroid = {
  SHORT: 0,
  LONG: 1,
  TOP: 49,
  showWithGravity: () => {},
};
