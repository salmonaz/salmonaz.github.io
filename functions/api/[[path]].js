const encoder = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});
const fail = (error, status = 400) => json({ error }, status);
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromB64url = value => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)),
  char => char.charCodeAt(0)
);

function safeEqual(a, b) {
  const first = encoder.encode(String(a || ""));
  const second = encoder.encode(String(b || ""));
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first[index] ^ second[index];
  return difference === 0;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function createSession(env) {
  const payload = b64url(encoder.encode(JSON.stringify({
    exp: Date.now() + 8 * 60 * 60 * 1000,
    nonce: crypto.randomUUID()
  })));
  return `${payload}.${await sign(payload, env.SESSION_SECRET)}`;
}

async function verifySession(request, env) {
  if (!env.SESSION_SECRET) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(signature, await sign(payload, env.SESSION_SECRET))) return false;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

async function requireAdmin(request, env) {
  return await verifySession(request, env) ? null : fail("Bạn không có quyền quản trị.", 401);
}

function missingAdminSecrets(env) {
  return ["ADMIN_PASSWORD", "SESSION_SECRET"].filter(name => !env[name]);
}

function studentPublic(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    schoolName: row.school_name || row.full_name,
    groupNo: row.group_no,
    photoUrl: row.photo_key ? `/api/photos/${encodeURIComponent(row.photo_key)}` : null
  };
}

async function getStudents(env) {
  const { results } = await env.DB
    .prepare("SELECT id, full_name, school_name, group_no, photo_key FROM students ORDER BY full_name COLLATE NOCASE")
    .all();
  return results.map(studentPublic);
}

async function publicHandler(request, env, path) {
  if (request.method === "GET" && path[0] === "health") {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ ok: true });
  }

  if (request.method === "GET" && path[0] === "students") {
    return json({ students: await getStudents(env) });
  }

  if (request.method === "GET" && path[0] === "seating") {
    const month = new URL(request.url).searchParams.get("month");
    if (!/^\d{4}-\d{2}$/.test(month || "")) return fail("Tháng không hợp lệ.");
    const { results } = await env.DB
      .prepare("SELECT seat_id, student_id FROM seating WHERE seat_month = ?")
      .bind(month)
      .all();
    return json({ month, assignments: Object.fromEntries(results.map(row => [row.seat_id, row.student_id])) });
  }

  if (request.method === "GET" && path[0] === "leaderboard") {
    const { results } = await env.DB.prepare(`
      SELECT s.id, s.full_name, s.school_name, s.group_no, s.photo_key,
             COALESCE(SUM(e.delta), 0) AS manual_total,
             o.final_score AS override_total, o.reason AS override_reason, o.updated_at AS override_updated_at
      FROM students s
      LEFT JOIN score_events e ON e.student_id = s.id
      LEFT JOIN student_score_overrides o ON o.student_id = s.id
      GROUP BY s.id
      ORDER BY s.full_name COLLATE NOCASE
    `).all();
    const students = results.map(row => {
      const manualTotal = Number(row.manual_total || 0);
      const overrideTotal = row.override_total === null || row.override_total === undefined ? null : Number(row.override_total);
      return {
        ...studentPublic(row),
        manualTotal,
        overrideTotal,
        overrideReason: row.override_reason || "",
        overrideUpdatedAt: row.override_updated_at || null,
        total: manualTotal
      };
    });
    return json({ students });
  }

  if (request.method === "GET" && path[0] === "photos" && path.length > 1) {
    const key = decodeURIComponent(path.slice(1).join("/"));
    const object = await env.PHOTOS.get(key);
    if (!object) return fail("Không tìm thấy ảnh.", 404);
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "public, max-age=3600",
        etag: object.httpEtag
      }
    });
  }

  return null;
}

async function validateStudentIds(env, ids) {
  const { results } = await env.DB.prepare("SELECT id FROM students").all();
  const knownIds = new Set(results.map(row => row.id));
  return ids.every(id => knownIds.has(id));
}

async function adminHandler(request, env, path) {
  if (request.method === "POST" && path[1] === "session") {
    const body = await request.json().catch(() => ({}));
    const missing = missingAdminSecrets(env);
    if (missing.length) return fail(`Thiếu cấu hình quản trị: ${missing.join(", ")}.`, 503);
    if (!safeEqual(body.password, env.ADMIN_PASSWORD)) return fail("Mật khẩu quản trị không đúng.", 401);
    return json({ token: await createSession(env), expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  }

  const missing = missingAdminSecrets(env);
  if (missing.length) return fail(`Thiếu cấu hình quản trị: ${missing.join(", ")}.`, 503);

  const blocked = await requireAdmin(request, env);
  if (blocked) return blocked;

  if (request.method === "POST" && path[1] === "students" && !path[2]) {
    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName || "").trim().replace(/\s+/g, " ");
    if (fullName.length < 2 || fullName.length > 100) return fail("Họ và tên không hợp lệ.");
    const groupNo = body.groupNo === null || body.groupNo === "" || body.groupNo === undefined ? null : Number(body.groupNo);
    if (groupNo !== null && ![1, 2, 3, 4].includes(groupNo)) return fail("Tổ không hợp lệ.");
    const id = `hs-${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO students (id, full_name, school_name, group_no, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, fullName, fullName, groupNo, new Date().toISOString()).run();
    return json({ ok: true, id }, 201);
  }

  if (request.method === "PUT" && path[1] === "seating") {
    const body = await request.json().catch(() => ({}));
    if (!/^\d{4}-\d{2}$/.test(body.month || "") || !body.assignments || typeof body.assignments !== "object" || Array.isArray(body.assignments)) {
      return fail("Dữ liệu chỗ ngồi không hợp lệ.");
    }
    const seatPattern = /^g([1-4])-d[1-5]-s[1-2]$/;
    const rows = Object.entries(body.assignments).map(([seat, studentId]) => {
      const match = seatPattern.exec(seat);
      return { seat, studentId, groupNo: match ? Number(match[1]) : null };
    });
    if (rows.some(row => !row.groupNo || typeof row.studentId !== "string" || !row.studentId.trim())) {
      return fail("Dữ liệu chỗ ngồi không hợp lệ.");
    }
    const ids = rows.map(row => row.studentId);
    if (new Set(ids).size !== ids.length) return fail("Một học sinh không thể ngồi ở hai chỗ.");
    if (!await validateStudentIds(env, ids)) return fail("Có học sinh không thuộc danh sách lớp.");

    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare("DELETE FROM seating WHERE seat_month = ?").bind(body.month),
      ...rows.map(({ seat, studentId }) => env.DB
        .prepare("INSERT INTO seating (seat_month, seat_id, student_id, updated_at) VALUES (?, ?, ?, ?)")
        .bind(body.month, seat, studentId, now)),
      ...[1, 2, 3, 4].flatMap(groupNo => {
        const memberIds = rows.filter(row => row.groupNo === groupNo).map(row => row.studentId);
        if (!memberIds.length) return [];
        const placeholders = memberIds.map(() => "?").join(", ");
        return [env.DB
          .prepare(`UPDATE students SET group_no = ? WHERE id IN (${placeholders})`)
          .bind(groupNo, ...memberIds)];
      })
    ];
    await env.DB.batch(statements);
    return json({ ok: true });
  }

  if (request.method === "POST" && path[1] === "scores") {
    const body = await request.json().catch(() => ({}));
    const delta = Number(body.delta);
    if (!body.studentId || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000) {
      return fail("Dữ liệu điểm không hợp lệ.");
    }
    const student = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(body.studentId).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    await env.DB.prepare(`
      INSERT INTO score_events (id, student_id, delta, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      body.studentId,
      delta,
      String(body.reason || "").slice(0, 300),
      new Date().toISOString()
    ).run();
    return json({ ok: true });
  }

  if (request.method === "PUT" && path[1] === "students" && path[2] && path[3] === "score-override") {
    const body = await request.json().catch(() => ({}));
    const finalScore = Number(body.finalScore);
    if (!Number.isFinite(finalScore) || Math.abs(finalScore) > 1000) return fail("Điểm ghi đè không hợp lệ.");
    const student = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    await env.DB.prepare(`
      INSERT INTO student_score_overrides (student_id, final_score, reason, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET
        final_score = excluded.final_score,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).bind(path[2], finalScore, String(body.reason || "").slice(0, 300), new Date().toISOString()).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE" && path[1] === "students" && path[2] && path[3] === "score-override") {
    await env.DB.prepare("DELETE FROM student_score_overrides WHERE student_id = ?").bind(path[2]).run();
    return new Response(null, { status: 204 });
  }

  if (request.method === "POST" && path[1] === "students" && path[2] && path[3] === "scores" && path[4] === "reset") {
    const student = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM score_events WHERE student_id = ?").bind(path[2]),
      env.DB.prepare("DELETE FROM student_score_overrides WHERE student_id = ?").bind(path[2])
    ]);
    return json({ ok: true });
  }

  if (request.method === "DELETE" && path[1] === "scores" && path[2]) {
    const result = await env.DB.prepare("DELETE FROM score_events WHERE id = ?").bind(path[2]).run();
    if (!result.meta.changes) return fail("Không tìm thấy lượt điểm.", 404);
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && path[1] === "students" && path[2] && path[3] === "scores") {
    const student = await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    const { results } = await env.DB.prepare(`
      SELECT id, delta, reason, created_at
      FROM score_events
      WHERE student_id = ?
      ORDER BY created_at DESC, id DESC
    `).bind(path[2]).all();
    const override = await env.DB.prepare(`
      SELECT final_score, reason, updated_at
      FROM student_score_overrides
      WHERE student_id = ?
    `).bind(path[2]).first();
    return json({ events: results.map(row => ({
      id: row.id,
      delta: Number(row.delta),
      reason: row.reason,
      createdAt: row.created_at
    })), override: override ? {
      finalScore: Number(override.final_score),
      reason: override.reason || "",
      updatedAt: override.updated_at
    } : null });
  }

  if (request.method === "PATCH" && path[1] === "students" && path[2]) {
    const body = await request.json().catch(() => ({}));
    const student = await env.DB.prepare("SELECT id, full_name, school_name, group_no FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    const hasName = Object.prototype.hasOwnProperty.call(body, "fullName");
    const hasGroup = Object.prototype.hasOwnProperty.call(body, "groupNo");
    const hasSchoolName = Object.prototype.hasOwnProperty.call(body, "schoolName");
    if (!hasName && !hasGroup && !hasSchoolName) return fail("Chưa có thay đổi để lưu.");
    const fullName = hasName ? String(body.fullName || "").trim().replace(/\s+/g, " ") : student.full_name;
    if (fullName.length < 2 || fullName.length > 100) return fail("Họ và tên không hợp lệ.");
    const schoolName = hasSchoolName ? String(body.schoolName || "").trim().replace(/\s+/g, " ") : (student.school_name || student.full_name);
    if (schoolName.length < 2 || schoolName.length > 100) return fail("Tên theo nguồn trường không hợp lệ.");
    const groupNo = hasGroup && (body.groupNo === null || body.groupNo === "") ? null : hasGroup ? Number(body.groupNo) : student.group_no;
    if (groupNo !== null && ![1, 2, 3, 4].includes(groupNo)) return fail("Tổ không hợp lệ.");
    await env.DB.prepare("UPDATE students SET full_name = ?, school_name = ?, group_no = ? WHERE id = ?").bind(fullName, schoolName, groupNo, path[2]).run();
    return json({ ok: true });
  }

  if (request.method === "DELETE" && path[1] === "students" && path[2] && !path[3]) {
    const student = await env.DB.prepare("SELECT photo_key FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM seating WHERE student_id = ?").bind(path[2]),
      env.DB.prepare("DELETE FROM score_events WHERE student_id = ?").bind(path[2]),
      env.DB.prepare("DELETE FROM student_score_overrides WHERE student_id = ?").bind(path[2]),
      env.DB.prepare("DELETE FROM students WHERE id = ?").bind(path[2])
    ]);
    if (student.photo_key) await env.PHOTOS.delete(student.photo_key);
    return new Response(null, { status: 204 });
  }

  if (path[1] === "students" && path[2] && path[3] === "photo") {
    const student = await env.DB.prepare("SELECT photo_key FROM students WHERE id = ?").bind(path[2]).first();
    if (!student) return fail("Không tìm thấy học sinh.", 404);

    if (request.method === "POST") {
      const form = await request.formData();
      const photo = form.get("photo");
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!photo || typeof photo === "string" || !allowedTypes.includes(photo.type) || photo.size > 5 * 1024 * 1024) {
        return fail("Ảnh phải là JPEG, PNG hoặc WebP, tối đa 5 MB.");
      }

      const extension = photo.type.split("/")[1].replace("jpeg", "jpg");
      const key = `students/${path[2]}/${crypto.randomUUID()}.${extension}`;
      await env.PHOTOS.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
      await env.DB.prepare("UPDATE students SET photo_key = ? WHERE id = ?").bind(key, path[2]).run();
      if (student.photo_key) await env.PHOTOS.delete(student.photo_key);
      return json({ ok: true, photoUrl: `/api/photos/${encodeURIComponent(key)}` });
    }

    if (request.method === "DELETE") {
      await env.DB.prepare("UPDATE students SET photo_key = NULL WHERE id = ?").bind(path[2]).run();
      if (student.photo_key) await env.PHOTOS.delete(student.photo_key);
      return new Response(null, { status: 204 });
    }
  }

  return fail("Không tìm thấy API quản trị.", 404);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS" } });
    }
    const publicResponse = await publicHandler(request, env, path);
    if (publicResponse) return publicResponse;
    if (path[0] === "admin") return await adminHandler(request, env, path);
    return fail("Không tìm thấy API.", 404);
  } catch (error) {
    console.error(error);
    return fail("Máy chủ gặp lỗi. Hãy kiểm tra binding D1, R2 và schema.", 500);
  }
}
