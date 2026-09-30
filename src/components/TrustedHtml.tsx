// The ONLY file allowed to use dangerouslySetInnerHTML (see the
// react/no-danger override in .eslintrc.json). It renders HTML that is known
// at build time and can never contain user or backend data:
//
//   <TrustedHtml html={trustedHtml`<b>Static</b> markup`} />
//
// `trustedHtml` is a tagged template that rejects interpolation, so the brand
// can't be put on a runtime string by mistake. Untrusted content goes through
// <SafeMarkdown> or <SafeText> instead — never here.

declare const brand: unique symbol;
export type TrustedHtmlString = string & { readonly [brand]: "TrustedHtml" };

export function trustedHtml(strings: TemplateStringsArray, ...values: never[]): TrustedHtmlString {
  if (values.length > 0 || strings.length !== 1) {
    throw new Error("trustedHtml`` does not allow interpolation");
  }
  return strings[0] as TrustedHtmlString;
}

export function TrustedHtml({ html, as: Tag = "span" }: { html: TrustedHtmlString; as?: "span" | "div" }) {
  return <Tag dangerouslySetInnerHTML={{ __html: html }} />;
}
