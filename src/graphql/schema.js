// สคีมา GraphQL ของ Book API (Lab 2): อ่านข้อมูลหนังสือ/ผู้แต่ง/หมวดหมู่ได้ยืดหยุ่น (เลือกเฉพาะฟิลด์ที่ต้องการ)
// และเพิ่ม/แก้ไข/ลบด้วย mutation (เฉพาะ admin) ใช้ชั้นข้อมูลและการตรวจข้อมูลชุดเดียวกับ REST
const { buildSchema } = require("graphql");

const typeDefs = /* GraphQL */ `
  type Author {
    id: ID!
    name: String!
    nationality: String
    birthYear: Int
    books: [Book!]!
  }

  type Category {
    id: ID!
    name: String!
  }

  type Book {
    id: ID!
    title: String!
    isbn: String!
    publishedYear: Int
    price: Float
    totalCopies: Int
    availableCopies: Int
    author: Author!
    categories: [Category!]!
  }

  type Pagination {
    page: Int!
    limit: Int!
    total: Int!
    totalPages: Int!
  }

  type BookPage {
    items: [Book!]!
    pagination: Pagination!
  }

  type DeleteResult {
    success: Boolean!
    message: String!
  }

  enum BookSortField {
    ID
    TITLE
    PUBLISHED_YEAR
    PRICE
    AVAILABLE_COPIES
  }

  enum SortOrder {
    ASC
    DESC
  }

  input BookInput {
    title: String!
    isbn: String!
    authorId: Int!
    publishedYear: Int
    price: Float
    categoryIds: [Int!]
  }

  input AuthorInput {
    name: String!
    nationality: String
    birthYear: Int
  }

  type Query {
    books(
      search: String
      authorId: Int
      categoryId: Int
      availableOnly: Boolean
      sortBy: BookSortField = ID
      order: SortOrder = ASC
      page: Int = 1
      limit: Int = 10
    ): BookPage!
    book(id: ID!): Book
    authors: [Author!]!
    author(id: ID!): Author
    categories: [Category!]!
  }

  type Mutation {
    createBook(input: BookInput!): Book!
    updateBook(id: ID!, input: BookInput!): Book!
    deleteBook(id: ID!): DeleteResult!
    createAuthor(input: AuthorInput!): Author!
    createCategory(name: String!): Category!
  }
`;

module.exports = { typeDefs, schema: buildSchema(typeDefs) };
