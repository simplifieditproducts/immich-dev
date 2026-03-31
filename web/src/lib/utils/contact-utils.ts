export function getInitials(name: string): string {
  const cleaned = name.replaceAll(/\p{Emoji_Presentation}/gu, '').trim();
  const parts = cleaned.split(' ').filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return parts
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
