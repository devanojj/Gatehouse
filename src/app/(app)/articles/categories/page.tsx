import Link from "next/link";

import { requireSession } from "@/lib/auth";
import { listCategoriesWithCounts } from "@/lib/kb-categories";

import { CategoryForm } from "./CategoryForm";
import { CategoryRow } from "./CategoryRow";

export default async function CategoriesPage() {
  const session = await requireSession();
  const categories = await listCategoriesWithCounts(session.orgId);

  return (
    <>
      <div className="page-head">
        <div>
          <div style={{ marginBottom: "6px" }}>
            <Link href="/articles" className="hint">
              ← Back to articles
            </Link>
          </div>
          <h1>Knowledge Base Categories</h1>
          <p>Organize articles into customer-facing topic collections.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Slug</th>
                <th>Order</th>
                <th>Articles</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="muted"
                    style={{ textAlign: "center", padding: "24px" }}
                  >
                    No categories created yet. Add one below.
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <CategoryRow key={category.id} category={category} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-title">Add a category</div>
        <CategoryForm />
      </div>
    </>
  );
}
