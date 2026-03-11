FROM node:18.17 as build

RUN npm config set strict-ssl false
RUN npm config set registry https://registry.npmjs.org/

WORKDIR /app

COPY . .

RUN npm install

RUN npm run build

EXPOSE 8080

CMD ["npm","start"]
