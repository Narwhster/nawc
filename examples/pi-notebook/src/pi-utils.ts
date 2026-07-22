export function leibniz(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.pow(-1, i) / (2 * i + 1);
  }
  return 4 * sum;
}

export function estimatePi(iterations: number): number {
  return leibniz(iterations);
}

export function errorFromPi(estimate: number): number {
  return Math.abs(Math.PI - estimate);
}
