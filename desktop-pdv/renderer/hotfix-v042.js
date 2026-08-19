// ThorPDV Desktop 0.4.2 hotfix
// Compatibility alias for checkout-v3.js: some operational flows still call vPerm().
// Keep permission checks centralized in v3Perm() so cancel, return and cash movement
// use the current operator profile consistently.
function vPerm(path, fallback = false) {
  return v3Perm(path, fallback);
}
