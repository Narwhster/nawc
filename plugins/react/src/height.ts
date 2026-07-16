export function clampReactInteractiveHeight(height: number): number {
  return Math.max(0, Math.min(768, height));
}
