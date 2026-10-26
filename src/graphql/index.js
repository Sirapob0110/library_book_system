// ตัวจัดการ GraphQL: POST /graphql (ต้องเข้าสู่ระบบ) body = { query, variables, operationName }
// ตามธรรมเนียม GraphQL: คำถามที่ผ่านการตรวจตอบ 200 และใส่ข้อผิดพลาดของ resolver ไว้ใน errors
// ส่วนคำถามที่ผิดไวยากรณ์/ไม่ตรงสคีมา/ซ้อนลึกเกินตอบ 400
const { parse, validate, execute, specifiedRules, GraphQLError, Kind } = require("graphql");

const pool = require("../db");
const catalog = require("../services/catalog");
const { bookSchema, authorSchema, categorySchema } = require("../schemas/catalog");
const { schema } = require("./schema");

const MAX_DEPTH = 5; // กันคำถามซ้อนชั้นลึกจนฐานข้อมูลทำงานหนัก

// ---------- loader: รวมการดึงข้อมูลลูกของหลายแถวเป็น query เดียว (กันปัญหา N+1) ----------
function createLoader(batchFn) {
  const memo = new Map();
  let queue = null;

  return {
    load(key) {
      if (memo.has(key)) return memo.get(key);

      const promise = new Promise((resolve, reject) => {
        if (!queue) {
          queue = [];
          Promise.resolve().then(async () => {
            const batch = queue;
            queue = null;

            try {
              const results = await batchFn([...new Set(batch.map((item) => item.key))]);
              batch.forEach((item) => item.resolve(results.get(item.key)));
            } catch (err) {
              batch.forEach((item) => item.reject(err));
            }
          });
        }

        queue.push({ key, resolve, reject });
      });

      memo.set(key, promise);
      return promise;
    },
  };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

function createLoaders() {
  return {
    author: createLoader(async (ids) => {
      const [rows] = await pool.query(
        "SELECT author_id, name, nationality, birth_year FROM authors WHERE author_id IN (?)",
        [ids],
      );
      return new Map(rows.map((row) => [row.author_id, toAuthor(row)]));
    }),
    categoriesOfBook: createLoader(async (ids) => {
      const [rows] = await pool.query(
        `SELECT bc.book_id, c.category_id, c.name
         FROM book_categories bc JOIN categories c ON bc.category_id = c.category_id
         WHERE bc.book_id IN (?) ORDER BY c.category_id`,
        [ids],
      );
      const grouped = groupBy(rows, "book_id");
      return new Map(ids.map((id) => [id, (grouped.get(id) || []).map(toCategory)]));
    }),
    booksOfAuthor: createLoader(async (ids) => {
      const [rows] = await pool.query(
        `SELECT book_id, title, isbn, published_year, price, total_copies, available_copies, author_id
         FROM books WHERE author_id IN (?) ORDER BY book_id`,
        [ids],
      );
      const grouped = groupBy(rows, "author_id");
      return new Map(ids.map((id) => [id, (grouped.get(id) || []).map(toBook)]));
    }),
  };
}

// ---------- แปลงแถวฐานข้อมูลเป็นรูปแบบของสคีมา (ฟิลด์ที่เป็นฟังก์ชันคือ resolver ของฟิลด์ลูก) ----------
function toCategory(row) {
  return { id: row.category_id, name: row.name };
}

function toAuthor(row) {
  return {
    id: row.author_id,
    name: row.name,
    nationality: row.nationality ?? null,
    birthYear: row.birth_year ?? null,
    books: (args, ctx) => ctx.loaders.booksOfAuthor.load(row.author_id),
  };
}

function toBook(row) {
  return {
    id: row.book_id,
    title: row.title,
    isbn: row.isbn,
    publishedYear: row.published_year ?? null,
    price: row.price == null ? null : Number(row.price),
    totalCopies: row.total_copies,
    availableCopies: row.available_copies,
    author: (args, ctx) => ctx.loaders.author.load(row.author_id),
    categories: (args, ctx) => ctx.loaders.categoriesOfBook.load(row.book_id),
  };
}

// ---------- ข้อผิดพลาด ----------
const fail = (message, code, extra = {}) =>
  new GraphQLError(message, { extensions: { code, ...extra } });

function requireAdmin(ctx) {
  if (ctx.user?.role !== "admin") {
    throw fail("ต้องเป็นผู้ดูแลระบบ (admin) เท่านั้น", "FORBIDDEN");
  }
}

function parseInput(schemaToUse, input) {
  const result = schemaToUse.safeParse(input);

  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw fail(details[0].message, "VALIDATION_ERROR", { details });
  }

  return result.data;
}

// แปลง error ของฐานข้อมูลเป็นข้อความที่ปลอดภัย ไม่เปิดเผยรายละเอียดภายใน
function wrap(resolver) {
  return async (args, ctx, info) => {
    try {
      return await resolver(args, ctx, info);
    } catch (err) {
      if (err instanceof GraphQLError) throw err;
      if (err.code === "ER_DUP_ENTRY") throw fail("ข้อมูลซ้ำ (เช่น ISBN หรือชื่อหมวดหมู่มีอยู่แล้ว)", "CONFLICT");
      if (err.code === "ER_NO_REFERENCED_ROW_2") {
        throw fail("authorId หรือ categoryIds ที่ระบุไม่มีอยู่ในระบบ", "BAD_REFERENCE");
      }

      console.error(err);
      throw fail("เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์", "INTERNAL_SERVER_ERROR");
    }
  };
}

// camelCase ของ GraphQL -> snake_case ที่ชั้นข้อมูลใช้
const bookInput = (input) => ({
  title: input.title,
  isbn: input.isbn,
  author_id: input.authorId,
  published_year: input.publishedYear,
  price: input.price,
  category_ids: input.categoryIds,
});

const rootValue = {
  books: wrap(async (args) => {
    const { rows, pagination } = await catalog.queryBooks({
      q: args.search,
      author_id: args.authorId,
      category_id: args.categoryId,
      available: args.availableOnly ? "true" : undefined,
      sort: args.sortBy.toLowerCase(),
      order: args.order.toLowerCase(),
      page: args.page,
      limit: args.limit,
    });

    return { items: rows.map(toBook), pagination };
  }),

  book: wrap(async ({ id }) => {
    const row = await catalog.getBookDetail(id);
    return row ? toBook(row) : null;
  }),

  authors: wrap(async () => (await catalog.listAuthors()).value.map(toAuthor)),

  author: wrap(async ({ id }, ctx) => {
    const author = await ctx.loaders.author.load(Number(id));
    return author ?? null;
  }),

  categories: wrap(async () => (await catalog.listCategories()).value.map(toCategory)),

  createBook: wrap(async ({ input }, ctx) => {
    requireAdmin(ctx);
    return toBook(await catalog.createBook(parseInput(bookSchema, bookInput(input))));
  }),

  updateBook: wrap(async ({ id, input }, ctx) => {
    requireAdmin(ctx);
    const row = await catalog.updateBook(id, parseInput(bookSchema, bookInput(input)));

    if (!row) throw fail("ไม่พบหนังสือเล่มนี้", "NOT_FOUND");

    return toBook(row);
  }),

  // ลบซ้ำไม่ใช่ error: ตอบ success:false พร้อมข้อความ (ต่างจาก REST ที่ตอบ 404)
  deleteBook: wrap(async ({ id }, ctx) => {
    requireAdmin(ctx);
    const deleted = await catalog.deleteBook(id);

    return deleted
      ? { success: true, message: `ลบหนังสือ ID ${id} แล้ว` }
      : { success: false, message: `ไม่พบหนังสือ ID ${id}` };
  }),

  createAuthor: wrap(async ({ input }, ctx) => {
    requireAdmin(ctx);
    const data = parseInput(authorSchema, {
      name: input.name,
      nationality: input.nationality,
      birth_year: input.birthYear,
    });
    return toAuthor(await catalog.createAuthor(data));
  }),

  createCategory: wrap(async ({ name }, ctx) => {
    requireAdmin(ctx);
    return toCategory(await catalog.createCategory(parseInput(categorySchema, { name })));
  }),
};

// ---------- จำกัดความลึกของคำถาม ----------
function depthOf(selectionSet, fragments, seen = new Set()) {
  if (!selectionSet) return 0;

  let max = 0;
  for (const selection of selectionSet.selections) {
    let depth = 0;

    if (selection.kind === Kind.FIELD) {
      depth = 1 + depthOf(selection.selectionSet, fragments, seen);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      depth = depthOf(selection.selectionSet, fragments, seen);
    } else if (selection.kind === Kind.FRAGMENT_SPREAD && !seen.has(selection.name.value)) {
      const fragment = fragments[selection.name.value];
      depth = fragment ? depthOf(fragment.selectionSet, fragments, new Set([...seen, selection.name.value])) : 0;
    }

    max = Math.max(max, depth);
  }

  return max;
}

function queryDepth(document) {
  const fragments = {};
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def;
  }

  return Math.max(
    0,
    ...document.definitions
      .filter((def) => def.kind === Kind.OPERATION_DEFINITION)
      .map((def) => depthOf(def.selectionSet, fragments)),
  );
}

// ข้อผิดพลาดที่ไม่ได้ตั้งใจโยน (เช่น query ของ loader ล้มเหลว) ต้องไม่เปิดเผยข้อความภายในให้ผู้เรียก
function maskInternalErrors(result) {
  if (!result.errors) return result;

  return {
    ...result,
    errors: result.errors.map((error) => {
      if (!error.originalError || error.originalError instanceof GraphQLError) return error;

      console.error(error.originalError);
      return {
        message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
        locations: error.locations,
        path: error.path,
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      };
    }),
  };
}

const badRequest = (res, message, code) =>
  res.status(400).json({ errors: [{ message, extensions: { code } }] });

async function graphqlHandler(req, res) {
  const { query, variables, operationName } = req.body || {};

  if (typeof query !== "string" || !query.trim()) {
    return badRequest(res, "ต้องระบุ query เป็นข้อความ", "BAD_REQUEST");
  }

  if (variables != null && (typeof variables !== "object" || Array.isArray(variables))) {
    return badRequest(res, "variables ต้องเป็น object", "BAD_REQUEST");
  }

  let document;
  try {
    document = parse(query);
  } catch (err) {
    return badRequest(res, err.message, "GRAPHQL_PARSE_FAILED");
  }

  const errors = validate(schema, document, specifiedRules);
  if (errors.length > 0) {
    return res.status(400).json({ errors: errors.map((e) => ({ message: e.message, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } })) });
  }

  if (queryDepth(document) > MAX_DEPTH) {
    return badRequest(res, `คำถามซ้อนลึกเกิน ${MAX_DEPTH} ชั้น`, "QUERY_TOO_DEEP");
  }

  const result = await execute({
    schema,
    document,
    rootValue,
    contextValue: { user: req.user, loaders: createLoaders() },
    variableValues: variables ?? undefined,
    operationName,
  });

  return res.status(200).json(maskInternalErrors(result));
}

module.exports = { graphqlHandler, queryDepth, MAX_DEPTH };
