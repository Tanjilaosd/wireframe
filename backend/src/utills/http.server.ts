import type { Server } from "node:http";

export const listenServer = (httpServer: Server, port: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      httpServer.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      httpServer.removeListener("error", onError);
      resolve();
    };

    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port);
  });