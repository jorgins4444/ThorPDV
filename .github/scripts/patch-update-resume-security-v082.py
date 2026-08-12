from pathlib import Path
import re

updater_path = Path('desktop-pdv/updater.js')
updater = updater_path.read_text(encoding='utf-8')

if 'createResumeToken(targetVersion)' not in updater:
    marker = '''  async launchVisualHelper({ installer, targetVersion }) {'''
    methods = r'''  createResumeToken(targetVersion) {
    try {
      const operator = this.agent.currentOperator?.() || null;
      if (!operator?.id || !this.agent?.codec?.encrypt) return '';
      const claim = JSON.stringify({
        operatorId: String(operator.id),
        targetVersion: String(targetVersion),
        issuedAt: new Date().toISOString(),
        nonce: crypto.randomUUID(),
      });
      const token = String(this.agent.codec.encrypt(claim) || '');
      // Session resumption is only trusted when Windows safeStorage actually encrypted it.
      return token.startsWith('enc:') ? token : '';
    } catch { return ''; }
  }

  resumeClaim(marker) {
    try {
      const token = String(marker?.resumeToken || '');
      if (!token.startsWith('enc:') || !this.agent?.codec?.decrypt) return null;
      const raw = this.agent.codec.decrypt(token);
      const claim = JSON.parse(raw || '{}');
      const issued = Date.parse(String(claim.issuedAt || ''));
      if (!claim.operatorId || String(claim.targetVersion) !== this.appVersion) return null;
      if (!Number.isFinite(issued) || Date.now() - issued > 30 * 60 * 1000) return null;
      return claim;
    } catch { return null; }
  }

'''
    if marker not in updater:
        raise SystemExit('updater: helper method marker not found')
    updater = updater.replace(marker, methods + marker, 1)

updater = updater.replace(
    "      const operator = this.agent.currentOperator?.() || null;\n      const marker = {",
    "      const resumeToken = this.createResumeToken(targetVersion);\n      const marker = {",
    1,
)
updater = updater.replace(
    "        resumeOperatorId: operator?.id || null,",
    "        resumeToken,",
    1,
)
updater = updater.replace(
    "        operator_resume: Boolean(marker.resumeOperatorId),",
    "        operator_resume: Boolean(marker.resumeToken),",
    1,
)
updater = updater.replace(
    "    const expectedOperatorId = String(marker.resumeOperatorId || this.agent.currentOperator?.()?.id || '');",
    "    const resumeClaim = this.resumeClaim(marker);\n    const expectedOperatorId = String(resumeClaim?.operatorId || '');",
    1,
)
if 'resumeOperatorId' in updater:
    raise SystemExit('updater: insecure resumeOperatorId marker remains')
updater_path.write_text(updater, encoding='utf-8')

main_path = Path('desktop-pdv/main.js')
main = main_path.read_text(encoding='utf-8')
start = main.find('function isFreshUpdateResume(marker) {')
end = main.find('\n\nasync function createWindow()', start)
if start < 0 or end < 0:
    raise SystemExit('main: isFreshUpdateResume markers not found')
secure_resume = r'''function validatedUpdateResume(marker, localCodec) {
  try {
    if (!marker?.targetVersion || String(marker.targetVersion) !== DESKTOP_VERSION) return null;
    const created = Date.parse(String(marker.createdAt || ''));
    if (!Number.isFinite(created) || Date.now() - created > 30 * 60 * 1000) return null;
    const token = String(marker.resumeToken || '');
    if (!token.startsWith('enc:')) return null;
    const claim = JSON.parse(localCodec.decrypt(token) || '{}');
    const issued = Date.parse(String(claim.issuedAt || ''));
    if (!claim.operatorId || String(claim.targetVersion) !== DESKTOP_VERSION) return null;
    if (!Number.isFinite(issued) || Date.now() - issued > 30 * 60 * 1000) return null;
    return claim;
  } catch { return null; }
}'''
main = main[:start] + secure_resume + main[end:]
main = main.replace(
    "  const pendingUpdate = readPendingUpdateMarker(dataDir);\n  const resumeUpdate = isFreshUpdateResume(pendingUpdate);",
    "  const pendingUpdate = readPendingUpdateMarker(dataDir);\n  const localCodec = codec();\n  const resumeClaim = validatedUpdateResume(pendingUpdate, localCodec);\n  const resumeUpdate = Boolean(resumeClaim);",
    1,
)
main = main.replace('    codec: codec(),', '    codec: localCodec,', 1)
if 'isFreshUpdateResume' in main:
    raise SystemExit('main: insecure resume helper remains')
if 'validatedUpdateResume' not in main or 'resumeToken' not in main:
    raise SystemExit('main: secure resume markers missing')
main_path.write_text(main, encoding='utf-8')
