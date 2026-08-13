// Sends every legacy hostname to the one live domain. Routes are in
// wrangler.toml: brainonbnb.ai (+www) and the old bobai.buildonbnbgame.xyz.
// Path and query survive, so deep links keep working.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'brainonbnb.com';
    return Response.redirect(url.toString(), 301);
  },
};
