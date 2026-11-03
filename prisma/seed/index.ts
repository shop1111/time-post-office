import { loadDemo } from "../../src/lib/demo/seed";
import { db } from "../../src/lib/db";

loadDemo()
  .then((r) => console.log(`示例人生已载入：${r.entries} 条记录，${r.letters} 封信`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
