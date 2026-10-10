<<<<<<< HEAD

=======
>>>>>>> d8328dd6a4b36c425cabd6bf4665a3562a126221
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
<<<<<<< HEAD
});
=======
});
>>>>>>> d8328dd6a4b36c425cabd6bf4665a3562a126221
