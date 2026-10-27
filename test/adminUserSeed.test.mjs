import assert from "node:assert/strict";
import { test } from "node:test";
import { adminUsers } from "../prisma/adminUsers.ts";

test("admin user seed contains 20 users with unique names and email addresses", () => {
	assert.equal(adminUsers.length, 20);
	assert.equal(new Set(adminUsers.map((user) => user.email)).size, 20);
	assert.equal(
		new Set(adminUsers.map((user) => `${user.forename} ${user.surname}`)).size,
		20,
	);

	const counts = {};
	for (const user of adminUsers) {
		counts[user.role] = (counts[user.role] ?? 0) + 1;
	}

	assert.deepEqual(counts, {
		SuperAdmin: 2,
		Admin: 4,
		InventoryManager: 4,
		FinanceManager: 4,
		CustomerService: 6,
	});
});

test("admin user seed respects Prisma field limits and includes valid credentials", () => {
	for (const user of adminUsers) {
		assert.ok(user.forename.length > 0 && user.forename.length <= 100);
		assert.ok(user.surname.length > 0 && user.surname.length <= 100);
		assert.match(user.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
		assert.ok(user.role.length > 0 && user.role.length <= 50);
		assert.ok(user.passwordHash.length > 0);
	}
});
