# MCP server entrypoint — stdio bridge to the live $BOBAI MCP endpoint.
#
# The actual server runs 24/7 as a Cloudflare Worker at https://brainonbnb.com/mcp
# (streamable HTTP, JSON-RPC 2.0, no auth, read-only). This image exposes it as a
# local stdio MCP server so any stdio-only client (or registry inspection) can use it:
#
#   docker build -t bobai-mcp . && docker run -i bobai-mcp
#
FROM node:22-alpine
RUN npm install -g mcp-remote
ENTRYPOINT ["mcp-remote", "https://brainonbnb.com/mcp"]
