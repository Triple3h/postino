/**
 * ApiFix Bin - 脚本执行 Worker(Phase 4.3 收敛版)
 *
 * pm.* 门面运行时不再内联在此文件,统一由构建产物 pm-facade.js 提供
 * (单一真源:src/scripting/pm-facade.ts;构建:npm run build:facade 或 node build.js)。
 * sandbox.html 通过 <script src="pm-facade.js"> 加载同一份产物,两者保证一致。
 */
importScripts('pm-facade.js');
