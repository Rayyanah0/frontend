import { notFound } from "next/navigation";

// Unmatched paths under a locale render the localized not-found page
// instead of Next's unlocalized default.
export default function CatchAll() {
  notFound();
}
