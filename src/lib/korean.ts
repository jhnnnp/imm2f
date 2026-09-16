export function withObjectParticle(value: string) {
  const last = value.trim().codePointAt(value.trim().length - 1);
  if (!last || last < 0xac00 || last > 0xd7a3) return `${value}을`;
  return `${value}${(last - 0xac00) % 28 === 0 ? "를" : "을"}`;
}
