// Locale-aware wrappers around Next's navigation APIs (#116). Use these
// instead of next/link and next/navigation for internal links so the
// current locale prefix is kept.
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
