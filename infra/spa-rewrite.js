function handler(event) {
  var request = event.request;
  // Assets and unknown file paths keep their original response; only app navigation rewrites.
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    (request.uri === '/' ||
      request.uri === '/campuses' ||
      request.uri === '/account' ||
      request.uri === '/auth/callback' ||
      /^\/c\/[a-f0-9-]+\/(issues|drafts|staff|service-reviews|library|membership)(\/[^.]*)?$/.test(
        request.uri,
      ))
  ) {
    request.uri = '/index.html';
  }
  return request;
}
