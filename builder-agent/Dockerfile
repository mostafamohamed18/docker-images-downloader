FROM node:20-alpine

# Install docker CLI (only the client — talks to the host daemon via socket)
RUN apk add --no-cache docker-cli

WORKDIR /app
COPY server.mjs ./

ENV PORT=8443
EXPOSE 8443

USER root
CMD ["node", "server.mjs"]
