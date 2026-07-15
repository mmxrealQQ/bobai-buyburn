# $BOBAI MCP server — local stdio transport, zero dependencies.
#
# Runs mcp/server.mjs: the MCP protocol is handled entirely in this container;
# live on-chain data comes from the public keyless REST endpoints documented
# at https://brainonbnb.com/skill.md. Introspection works fully offline.
#
#   docker build -t bobai-mcp . && docker run -i bobai-mcp
#
FROM node:22-alpine
WORKDIR /app
COPY mcp/server.mjs mcp/server.mjs
CMD ["node", "mcp/server.mjs"]
