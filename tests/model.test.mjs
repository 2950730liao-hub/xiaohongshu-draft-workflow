import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { rewrite } from "../src/model.mjs";
test("文字模型通过正常HTTP入口携带凭据并记录实际返回用量，错误体不外泄", async (t) => {
  const names = ["XHS_MODEL_BASE_URL", "XHS_MODEL_NAME", "XHS_MODEL_API_KEY"];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  const credential = randomUUID();
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    assert.equal(request.headers.authorization, "Bearer " + credential);
    assert.equal(request.url, "/v1/chat/completions");
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).model, "controlled-model");
    response.setHeader("Content-Type", "application/json");
    if (requests === 1)
      response.end(
        JSON.stringify({
          id: "controlled-request",
          usage: { prompt_tokens: 20 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "测试",
                  body: "测试稿",
                  tags: [],
                  facts: [],
                }),
              },
            },
          ],
        }),
      );
    else {
      response.statusCode = 401;
      response.end(JSON.stringify({ detail: credential }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.XHS_MODEL_BASE_URL =
    "http://127.0.0.1:" + server.address().port + "/v1";
  process.env.XHS_MODEL_NAME = "controlled-model";
  process.env.XHS_MODEL_API_KEY = credential;
  const result = await rewrite({}, {});
  assert.equal(result.usage.prompt_tokens, 20);
  assert.equal(result.actualCost, null);
  await assert.rejects(
    rewrite({}, {}),
    (error) => error.definite === true && !error.message.includes(credential),
  );
});
