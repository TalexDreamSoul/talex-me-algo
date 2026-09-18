import { ref, shallowRef } from 'vue';

export const overview = shallowRef(null);
export const loading = ref(false);

async function req(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: opts?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error(`${path} 返回 ${res.status}`);
  return res.json();
}

export async function loadOverview() {
  loading.value = true;
  try {
    overview.value = await req('/api/overview');
  } finally {
    loading.value = false;
  }
  return overview.value;
}

export const getProblem = (id) => req(`/api/problem/${id}`);

export const patchProblem = (id, body) =>
  req(`/api/problem/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const openInEditor = (id, file) =>
  req('/api/open', { method: 'POST', body: JSON.stringify({ id, file }) });
