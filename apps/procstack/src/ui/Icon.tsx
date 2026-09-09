interface IconProps {
  d: string;
  size?: number;
}

export function Icon({ d, size = 15 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

export const P_EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z";
export const P_EYE_OFF =
  "M3 3l18 18 M10.6 10.7a3 3 0 004.2 4.2 M6.7 6.8C4 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4 M12 5c6.5 0 10 7 10 7s-.8 1.6-2.3 3.2";
export const P_TRASH = "M4 7h16 M9 7V5h6v2 M6 7l1 13h10l1-13";
export const P_UP = "M12 19V5 M5 12l7-7 7 7";
export const P_DOWN = "M12 5v14 M19 12l-7 7-7-7";
export const P_PLUS = "M12 5v14 M5 12h14";
export const P_FRAME = "M4 8V4h4 M20 8V4h-4 M4 16v4h4 M20 16v4h-4";
