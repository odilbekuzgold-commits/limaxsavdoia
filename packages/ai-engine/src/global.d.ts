declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    cwd(): string;
    env: ProcessEnv;
  }
}
