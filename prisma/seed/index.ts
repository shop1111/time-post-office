/**
 * 给某个账号导入示例数据（会替换该账号现有的数据）：
 *   npm run seed -- <用户名>
 * 也可以登录后在「设置 → 示例数据」里点按钮导入。
 */
import { loadDemo } from "../../src/lib/demo/seed";
import { authDb, disconnectAll, runAsUser } from "../../src/lib/tenancy";
import { normalizeUsername } from "../../src/lib/username";

async function main() {
  const username = normalizeUsername(process.argv[2]);
  if (!username) throw new Error("用法：npm run seed -- <用户名>（先在网页上注册这个账号）");
  const user = await authDb.user.findUnique({ where: { username } });
  if (!user) throw new Error(`没有用户 ${username}，请先在网页上注册`);
  const r = await runAsUser(user.id, () => loadDemo());
  console.log(`示例人生已载入 ${username}：${r.entries} 条记录，${r.letters} 封信`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectAll());
