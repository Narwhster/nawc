export function countLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
