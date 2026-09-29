"use client";

export function ExportButton({ onClick, label = "Export CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="zn-tap" style={{
      fontSize: 11, color: "var(--text-mid)", background: "none",
      border: "1px solid var(--border-default)", padding: "5px 12px", cursor: "pointer",
    }}>
      {label}
    </button>
  );
}
