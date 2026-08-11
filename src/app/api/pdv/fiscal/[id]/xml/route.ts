import { loadFiscalDelivery } from '@/lib/fiscal/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const delivery = await loadFiscalDelivery(request, id);
  if (!delivery.ok) {
    const status = delivery.error === 'fiscal_asset_auth_required' ? 401 : delivery.error === 'document_not_found' ? 404 : 403;
    return Response.json(delivery, { status });
  }

  const xml = String(delivery.xml ?? '');
  if (!xml) return Response.json({ ok: false, error: 'xml_not_available' }, { status: 404 });

  const number = String(delivery.document?.number ?? id).replace(/[^0-9A-Za-z_-]/g, '');
  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename="NFCe-${number}.xml"`,
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}
