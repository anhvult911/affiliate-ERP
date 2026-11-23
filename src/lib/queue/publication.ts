/** Unset preserves existing installations. Unknown explicit modes never enable posting. */
export function affiliateDraftOnly(): boolean {
  const mode = process.env.AFFILIATE_COMMENT_MODE;
  return mode !== undefined && mode.trim() !== "publish";
}
