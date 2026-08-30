/** The gatehouse mark: a roof peak over a doorway. */
export function GatehouseMark({ size = 22 }: { size?: number }) {
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
      aria-hidden="true"
    >
      <path d="M3 11 12 4l9 7" />
      <rect x="9" y="13" width="6" height="7" rx="1" />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="logo">
      <GatehouseMark size={size} />
      Gatehouse
    </span>
  );
}
