'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authorizeNfceDocument } from '@/lib/fiscal/thorfiscal';

const SESSION_COOKIE = 'thorpdv_test_session';

async function getSessionToken() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  return token;
}

export async function erpFiscalSend(documentId: string) {
  const token = await getSessionToken();
  return authorizeNfceDocument(documentId, { sessionToken: token });
}
