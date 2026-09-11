/**
 * Action icons, drawn.
 *
 * The glyphs these replace (✓ ✕ ↗ †) were text characters asked to carry
 * meaning — and a dagger asked to mean "delete permanently, no undo". One
 * stroke weight, one grid, the same discipline as the treatment marks.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden focusable="false">
      {children}
    </svg>
  );
}

export const UsefulIcon = () => (
  <Glyph>
    <path d="M3 8.5 6.5 12 13 4.5" {...stroke} />
  </Glyph>
);

export const NotUsefulIcon = () => (
  <Glyph>
    <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
  </Glyph>
);

export const ShareIcon = () => (
  <Glyph>
    <path d="M8 11V3M8 3 5 6M8 3l3 3" {...stroke} />
    <path d="M3 10v2.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V10" {...stroke} />
  </Glyph>
);

export const DeleteIcon = () => (
  <Glyph>
    <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5" {...stroke} />
    <path d="M5 4.5 5.6 13h4.8l.6-8.5" {...stroke} />
  </Glyph>
);

export const BackIcon = () => (
  <Glyph>
    <path d="M12 8H4M4 8l3.5-3.5M4 8l3.5 3.5" {...stroke} />
  </Glyph>
);
