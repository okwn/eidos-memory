const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const CYAN  = '\x1b[36m';
const RESET = '\x1b[0m';

export function createSpinner(label: string): { stop: (finalLine?: string) => void } {
  if (!process.stdout.isTTY) {
    process.stdout.write(`  ${label}...\n`);
    return { stop: (f) => { if (f) process.stdout.write(`  ${f}\n`); } };
  }

  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r  ${CYAN}${FRAMES[i++ % FRAMES.length]}${RESET}  ${label}`);
  }, 80);

  return {
    stop(finalLine?: string) {
      clearInterval(timer);
      process.stdout.write('\r\x1b[2K'); // clear line
      if (finalLine) process.stdout.write(`  ${finalLine}\n`);
    },
  };
}

export const c = {
  green:   (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:     (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow:  (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:    (s: string) => `\x1b[36m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  bold:    (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:     (s: string) => `\x1b[2m${s}\x1b[0m`,
};
