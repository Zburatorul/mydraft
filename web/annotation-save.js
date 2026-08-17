export async function annotationSaveDisposition(response, fallbackMessage = "Failed to save annotation") {
  if (response.ok) return { close: true, reload: false, error: null };
  const data = await response.json().catch(() => ({}));
  return {
    close: false,
    reload: response.status === 409,
    error: data.error || fallbackMessage,
  };
}
