import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 所有测试共享固定子进程端口分配策略，串行执行避免互相干扰
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
