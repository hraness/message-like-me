export type CommandIo = Readonly<{
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
}>;

export const processIo: CommandIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  now: () => new Date(),
};
