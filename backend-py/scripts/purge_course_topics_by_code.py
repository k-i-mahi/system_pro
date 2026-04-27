#!/usr/bin/env python3
"""
Purge topics and materials for configured course codes (default: CSE3217, CSE3210, CSE3247).

- Lists course id, topic ids, material ids, and Cloudinary public_ids.
- With --execute: deletes remote assets first (strict Cloudinary destroy), then topics via
  courses_service.delete_topic (CASCADE removes materials/embeddings).

Usage:
  cd backend-py
  .\\.venv\\Scripts\\python.exe scripts/purge_course_topics_by_code.py --dry-run
  .\\.venv\\Scripts\\python.exe scripts/purge_course_topics_by_code.py --execute

Requires DATABASE_URL and Cloudinary env vars for --execute when materials have public_id.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Allow "python scripts/..." from backend-py
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.course import Material, Topic
from app.services import courses_service
from app.services.course_identity import find_course_by_code, normalize_course_code


DEFAULT_CODES = ("CSE3217", "CSE3210", "CSE3247")


async def _collect_course_payload(db, course_id: str, include_personal: bool) -> dict:
    stmt = select(Topic).where(Topic.course_id == course_id)
    if not include_personal:
        stmt = stmt.where(Topic.is_personal.is_(False))
    topics = (await db.execute(stmt)).scalars().all()
    out_topics = []
    for t in topics:
        mats = (await db.execute(select(Material).where(Material.topic_id == t.id))).scalars().all()
        out_topics.append({
            "topicId": t.id,
            "title": t.title,
            "isPersonal": t.is_personal,
            "materials": [
                {
                    "materialId": m.id,
                    "title": m.title,
                    "publicId": m.public_id,
                    "fileType": m.file_type.value if hasattr(m.file_type, "value") else str(m.file_type),
                }
                for m in mats
            ],
        })
    return {
        "courseId": course_id,
        "topics": out_topics,
        "topicCount": len(out_topics),
        "materialCount": sum(len(x["materials"]) for x in out_topics),
        "publicIds": [m["publicId"] for t in out_topics for m in t["materials"] if m["publicId"]],
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description="Purge topics/materials for course codes")
    parser.add_argument(
        "--codes",
        default=",".join(DEFAULT_CODES),
        help="Comma-separated course codes (default: %(default)s)",
    )
    parser.add_argument(
        "--include-personal",
        action="store_true",
        help="Also delete student personal (study-log) topics for these courses",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform deletes (default is dry-run report only)",
    )
    args = parser.parse_args()
    codes = [normalize_course_code(c) for c in args.codes.split(",") if c.strip()]

    report: dict = {
        "dryRun": not args.execute,
        "includePersonal": args.include_personal,
        "requestedCodes": codes,
        "courses": [],
        "missingCourseCodes": [],
        "deletedTopicIds": [],
        "deletedMaterialIds": [],
        "cloudinaryPublicIdsDestroyed": [],
        "errors": [],
    }

    async with AsyncSessionLocal() as db:
        for code in codes:
            course = await find_course_by_code(db, code)
            if not course:
                report["missingCourseCodes"].append(code)
                continue
            payload = await _collect_course_payload(db, course.id, args.include_personal)
            payload["courseCode"] = course.course_code
            entry = {"match": code, **payload}

            if args.execute:
                for t in payload["topics"]:
                    tid = t["topicId"]
                    try:
                        await courses_service.delete_topic(db, tid)
                        report["deletedTopicIds"].append(tid)
                        for m in t["materials"]:
                            report["deletedMaterialIds"].append(m["materialId"])
                            if m["publicId"]:
                                report["cloudinaryPublicIdsDestroyed"].append(m["publicId"])
                    except Exception as exc:
                        report["errors"].append({"topicId": tid, "error": str(exc)})
                        print(json.dumps(report, indent=2, default=str))
                        return 1
            report["courses"].append(entry)

    print(json.dumps(report, indent=2, default=str))
    if args.execute and report["errors"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
