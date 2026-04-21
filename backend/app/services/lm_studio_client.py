from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from app.config import (
    LM_STUDIO_API_KEY,
    LM_STUDIO_BASE_URL,
    LM_STUDIO_CHAT_COMPLETIONS_PATH,
    LM_STUDIO_EXTRACTOR_MAX_TOKENS,
    LM_STUDIO_EXTRACTOR_MODEL,
    LM_STUDIO_MODEL,
    LM_STUDIO_NARRATION_MAX_TOKENS,
    LM_STUDIO_SUMMARY_MAX_TOKENS,
    LM_STUDIO_TIMEOUT_SECONDS,
    PROMPTS_DIR,
)
from app.domain.models import ExtractionEnvelope


class LMStudioClient:
    AUTO_MODEL_SENTINELS = {"", "auto", "current", "loaded", "current_loaded"}
    MAX_PROMPT_RESULTS = 8
    MAX_PROMPT_MUTATIONS = 10
    MAX_PROMPT_TEXT_CHARS = 280
    MAX_PROMPT_LORE_CHARS = 320

    def __init__(
        self,
        *,
        base_url: str = LM_STUDIO_BASE_URL,
        narrator_model: str = LM_STUDIO_MODEL,
        extractor_model: str = LM_STUDIO_EXTRACTOR_MODEL,
        api_key: str = LM_STUDIO_API_KEY,
        timeout_seconds: float = LM_STUDIO_TIMEOUT_SECONDS,
        narration_max_tokens: int = LM_STUDIO_NARRATION_MAX_TOKENS,
        extractor_max_tokens: int = LM_STUDIO_EXTRACTOR_MAX_TOKENS,
        summary_max_tokens: int = LM_STUDIO_SUMMARY_MAX_TOKENS,
        prompts_dir: Path = PROMPTS_DIR,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.narrator_model = narrator_model
        self.extractor_model = extractor_model or narrator_model
        self.api_key = api_key.strip()
        self.timeout_seconds = timeout_seconds
        self.narration_max_tokens = narration_max_tokens
        self.extractor_max_tokens = extractor_max_tokens
        self.summary_max_tokens = summary_max_tokens
        self.prompts_dir = prompts_dir

    def generate_narration(self, *, player_input: str, narration_context: dict[str, Any]) -> tuple[str, str]:
        model = self._resolve_model(self.narrator_model)

        system_prompt = self._load_prompt("narrator_system_prompt.md")
        activated_lore_entries = narration_context.get("activated_lore_entries", [])
        recent_chat_messages = narration_context.get("recent_chat_messages", [])
        context_for_prompt = self._build_compact_turn_context(narration_context)
        prompt_parts = [
            "Player input:",
            player_input or "(no direct player text supplied)",
        ]
        if recent_chat_messages:
            prompt_parts.extend(
                [
                    "Recent conversation context (most recent last):",
                    self._render_chat_context(recent_chat_messages),
                ]
            )
        prompt_parts.extend(
            [
                "Authoritative turn context (JSON):",
                json.dumps(context_for_prompt, separators=(",", ":"), ensure_ascii=False),
            ]
        )
        if activated_lore_entries:
            prompt_parts.extend(
                [
                    "Activated lore entries selected for this turn (JSON):",
                    json.dumps(self._compact_lore_entries(activated_lore_entries), separators=(",", ":"), ensure_ascii=False),
                ]
            )
        prompt_parts.append("Return prose only.")
        if self.narration_max_tokens > 0:
            prompt_parts.append("Keep the response compact: usually 1-3 paragraphs, no more than the requested output token budget.")
        prompt = "\n\n".join(
            prompt_parts
        )
        content = self._chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
            max_tokens=self.narration_max_tokens,
        )
        return content, model

    def extract_updates(
        self,
        *,
        player_input: str,
        narration_context: dict[str, Any],
        prose: str,
    ) -> tuple[ExtractionEnvelope, str]:
        model = self._resolve_model(self.extractor_model or self.narrator_model)

        system_prompt = self._load_prompt("extractor_system_prompt.md")
        schema_prompt = "\n".join(
            [
                "Return a JSON object with the exact shape:",
                '{"updates":[{"category":"item_change|quest_progress|location_change|condition_change|scene_object_change|relationship_shift","description":"human summary","confidence":0.0,"payload":{}}]}',
                "Payload guidance:",
                '- item_change: {"item_name": str, "quantity_delta": int, "description": optional str, "kind": optional str}',
                '- quest_progress: {"quest_name": str, "status": optional str, "note": optional str, "current_stage": optional str}',
                '- location_change: {"location": str, "scene_id": optional str, "time_of_day": optional str}',
                '- condition_change: {"condition": str, "action": "add"|"remove"}',
                '- scene_object_change: {"object_name": str, "description": optional str, "visible": optional bool}',
                '- relationship_shift: {"target_name": str, "note": str}',
                "Do not include any extra top-level keys.",
            ]
        )
        prompt = "\n\n".join(
            [
                schema_prompt,
                "Player input:",
                player_input or "(no direct player text supplied)",
                "Authoritative turn context (JSON):",
                json.dumps(self._build_compact_turn_context(narration_context), separators=(",", ":"), ensure_ascii=False),
                "Narrated prose:",
                prose,
            ]
        )
        content = self._chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=self.extractor_max_tokens,
        )
        try:
            parsed = self._parse_json_content(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Extractor response was not valid JSON: {content}") from exc
        return ExtractionEnvelope.model_validate(parsed), model

    def generate_scene_close_summary(
        self,
        *,
        scene_state: dict[str, Any],
        recent_events: list[dict[str, Any]],
        recent_journal: list[dict[str, Any]],
        instructions: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        model = self._resolve_model(self.narrator_model)

        system_prompt = self._load_prompt("scene_summary_system_prompt.md")
        schema_prompt = "\n".join(
            [
                "Return a JSON object with the exact shape:",
                '{"summary":"concise scene close summary","durable_facts":["fact safe to preserve"],"warnings":[]}',
                "Use only facts supported by the provided scene, event, and journal context.",
                "Do not close the scene or invent hidden state.",
            ]
        )
        prompt = "\n\n".join(
            [
                schema_prompt,
                "Optional user instructions:",
                instructions or "(none)",
                "Current scene state (JSON):",
                json.dumps(scene_state, indent=2),
                "Recent events (JSON):",
                json.dumps(recent_events, indent=2),
                "Recent journal entries (JSON):",
                json.dumps(recent_journal, indent=2),
            ]
        )
        content = self._chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=self.summary_max_tokens,
        )
        return self._parse_summary_draft_content(content), model

    def generate_session_summary_from_chat(
        self,
        *,
        chat_title: str | None,
        messages: list[dict[str, Any]],
        authoritative_context: dict[str, Any],
        instructions: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        model = self._resolve_model(self.narrator_model)

        system_prompt = self._load_prompt("session_summary_system_prompt.md")
        schema_prompt = "\n".join(
            [
                "Return a JSON object with the exact shape:",
                '{"summary":"concise session summary","durable_facts":["fact safe to preserve"],"warnings":[]}',
                "Use only facts supported by the provided transcript and authoritative context.",
                "Do not invent inventory, quest completion, resource usage, relationship scores, or hidden motives unless explicit.",
                "Treat this as a draft for durable memory, not a state mutation.",
            ]
        )
        prompt = "\n\n".join(
            [
                schema_prompt,
                "Optional user instructions:",
                instructions or "(none)",
                "Chat title:",
                chat_title or "(none)",
                "Authoritative context (JSON):",
                json.dumps(authoritative_context, indent=2, ensure_ascii=False),
                "Chat transcript (most recent last):",
                self._render_chat_context(messages),
            ]
        )
        content = self._chat_completion(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=self.summary_max_tokens,
        )
        return self._parse_summary_draft_content(content), model

    def _load_prompt(self, filename: str) -> str:
        return (self.prompts_dir / filename).read_text(encoding="utf-8")

    def _resolve_model(self, configured_model: str | None) -> str:
        candidate = str(configured_model or "").strip()
        if candidate.lower() not in self.AUTO_MODEL_SENTINELS:
            return candidate

        models = self._list_models()
        for model_id in models:
            lowered = model_id.casefold()
            if "embedding" in lowered or lowered.startswith("text-embedding"):
                continue
            return model_id
        raise RuntimeError("LM Studio did not report any usable chat model.")

    def _list_models(self) -> list[str]:
        req = request.Request(
            parse.urljoin(f"{self.base_url}/", "v1/models"),
            headers=self._build_headers(),
            method="GET",
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LM Studio model list request failed ({exc.code}): {detail}") from exc
        except OSError as exc:
            raise RuntimeError(f"LM Studio model list request failed: {exc}") from exc

        parsed = json.loads(body)
        data = parsed.get("data", []) if isinstance(parsed, dict) else []
        model_ids = []
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if model_id:
                model_ids.append(model_id)
        return model_ids

    def _chat_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float,
        max_tokens: int | None = None,
    ) -> str:
        payload_dict: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None and max_tokens > 0:
            payload_dict["max_tokens"] = int(max_tokens)
        payload = json.dumps(
            payload_dict
        ).encode("utf-8")
        req = request.Request(
            f"{self.base_url}{LM_STUDIO_CHAT_COMPLETIONS_PATH}",
            data=payload,
            headers=self._build_headers(),
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LM Studio request failed ({exc.code}): {detail}") from exc
        except OSError as exc:
            raise RuntimeError(f"LM Studio request failed: {exc}") from exc

        parsed = json.loads(body)
        try:
            content = parsed["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("LM Studio response did not contain a chat completion message.") from exc

        if isinstance(content, list):
            return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        return str(content)

    def _build_headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _parse_json_content(self, content: str) -> Any:
        stripped = str(content).strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped, count=1, flags=re.IGNORECASE)
            stripped = re.sub(r"\s*```$", "", stripped, count=1)

        try:
            return self._normalize_extractor_json(json.loads(stripped))
        except json.JSONDecodeError as exc:
            array_start = stripped.find("[")
            array_end = stripped.rfind("]")
            if array_start != -1 and array_end != -1 and array_end > array_start:
                try:
                    return self._normalize_extractor_json(json.loads(stripped[array_start : array_end + 1]))
                except json.JSONDecodeError:
                    pass

            recovered_updates = self._recover_partial_extractor_updates(stripped)
            if recovered_updates:
                return {"updates": recovered_updates}

            start = stripped.find("{")
            end = stripped.rfind("}")
            if start == -1 or end == -1 or end < start:
                raise exc
            return self._normalize_extractor_json(json.loads(stripped[start : end + 1]))

    def _recover_partial_extractor_updates(self, content: str) -> list[dict[str, Any]]:
        updates_key = content.find('"updates"')
        array_start = content.find("[", updates_key if updates_key != -1 else 0)
        if array_start == -1:
            return []

        objects: list[dict[str, Any]] = []
        index = array_start + 1
        while index < len(content):
            object_start = content.find("{", index)
            if object_start == -1:
                break
            object_end = self._find_balanced_json_object_end(content, object_start)
            if object_end == -1:
                break
            try:
                parsed = json.loads(content[object_start : object_end + 1])
            except json.JSONDecodeError:
                break
            if isinstance(parsed, dict):
                objects.append(parsed)
            index = object_end + 1

        return objects

    def _find_balanced_json_object_end(self, content: str, start: int) -> int:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(content)):
            char = content[index]
            if escaped:
                escaped = False
                continue
            if char == "\\" and in_string:
                escaped = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return index
        return -1

    def _normalize_extractor_json(self, parsed: Any) -> Any:
        if isinstance(parsed, list):
            return {"updates": parsed}
        if isinstance(parsed, dict) and "updates" not in parsed and "category" in parsed:
            return {"updates": [parsed]}
        return parsed

    def _parse_summary_draft_content(self, content: str) -> dict[str, Any]:
        stripped = str(content).strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped, count=1, flags=re.IGNORECASE)
            stripped = re.sub(r"\s*```$", "", stripped, count=1)

        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            start = stripped.find("{")
            end = stripped.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    parsed = json.loads(stripped[start : end + 1])
                except json.JSONDecodeError:
                    return self._summary_draft_prose_fallback(stripped)
            else:
                return self._summary_draft_prose_fallback(stripped)

        if not isinstance(parsed, dict):
            return self._summary_draft_prose_fallback(stripped)

        summary = str(parsed.get("summary") or parsed.get("scene_summary") or parsed.get("text") or "").strip()
        durable_facts = self._coerce_string_list(parsed.get("durable_facts") or parsed.get("facts") or [])
        warnings = self._coerce_string_list(parsed.get("warnings") or [])
        if not summary:
            fallback = self._summary_draft_prose_fallback(stripped)
            return {
                "summary": fallback["summary"],
                "durable_facts": durable_facts,
                "warnings": list(dict.fromkeys(warnings + ["model_json_missing_summary"])),
            }
        return {"summary": summary, "durable_facts": durable_facts, "warnings": warnings}

    def _summary_draft_prose_fallback(self, content: str) -> dict[str, Any]:
        summary = str(content or "").strip() or "No scene summary could be drafted from the model response."
        return {
            "summary": summary,
            "durable_facts": [],
            "warnings": ["model_returned_prose_fallback"],
        }

    def _parse_scene_summary_content(self, content: str) -> dict[str, Any]:
        return self._parse_summary_draft_content(content)

    def _coerce_string_list(self, value: Any) -> list[str]:
        if isinstance(value, str):
            raw_items = re.split(r"[\n;]+", value)
        elif isinstance(value, list):
            raw_items = value
        else:
            raw_items = []
        return [str(item).strip() for item in raw_items if str(item).strip()]

    def _render_chat_context(self, messages: Any) -> str:
        rendered: list[str] = []
        for message in messages if isinstance(messages, list) else []:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role") or "assistant").strip().lower()
            content = str(message.get("content") or "").strip()
            if not content:
                continue
            name = str(message.get("name") or "").strip()
            speaker = name or ("User" if role == "user" else "Assistant")
            rendered.append(f"{speaker}: {content}")
        return "\n".join(rendered) if rendered else "(no recent conversation context supplied)"

    def _build_compact_turn_context(self, narration_context: dict[str, Any]) -> dict[str, Any]:
        compact: dict[str, Any] = {
            "turn_id": narration_context.get("turn_id"),
            "actor_id": narration_context.get("actor_id"),
            "mode": narration_context.get("mode"),
            "failure_policy": narration_context.get("failure_policy"),
            "scene": narration_context.get("scene") or {},
            "turn_summary": narration_context.get("turn_summary") or {},
            "post_command_overview": narration_context.get("post_command_overview") or {},
            "refresh_hints": narration_context.get("refresh_hints") or [],
        }

        if narration_context.get("command_results"):
            compact["command_results"] = self._compact_command_results(narration_context.get("command_results"))
        if narration_context.get("state_changes"):
            compact["state_changes"] = self._compact_mutations(narration_context.get("state_changes"))
        if narration_context.get("discarded_state_changes"):
            compact["discarded_state_changes"] = self._compact_mutations(narration_context.get("discarded_state_changes"))
        if narration_context.get("rollback_event_id"):
            compact["rollback_event_id"] = narration_context.get("rollback_event_id")

        return compact

    def _compact_command_results(self, results: Any) -> list[dict[str, Any]]:
        compacted: list[dict[str, Any]] = []
        for result in results if isinstance(results, list) else []:
            if not isinstance(result, dict):
                continue
            compact_result = {
                "name": result.get("name"),
                "argument": self._trim_text(result.get("argument"), limit=self.MAX_PROMPT_TEXT_CHARS),
                "ok": result.get("ok"),
                "message": self._trim_text(result.get("message"), limit=self.MAX_PROMPT_TEXT_CHARS),
                "error_code": result.get("error_code"),
            }
            compact_mutations = self._compact_mutations(result.get("mutations"), limit=3)
            if compact_mutations:
                compact_result["mutations"] = compact_mutations
            compacted.append({key: value for key, value in compact_result.items() if value not in (None, "", [])})
            if len(compacted) >= self.MAX_PROMPT_RESULTS:
                break
        return compacted

    def _compact_mutations(self, mutations: Any, *, limit: int | None = None) -> list[dict[str, Any]]:
        compacted: list[dict[str, Any]] = []
        max_items = limit or self.MAX_PROMPT_MUTATIONS
        for mutation in mutations if isinstance(mutations, list) else []:
            if not isinstance(mutation, dict):
                continue
            compact_mutation = {
                "path": mutation.get("path"),
                "kind": mutation.get("kind"),
                "note": self._trim_text(mutation.get("note"), limit=self.MAX_PROMPT_TEXT_CHARS),
            }
            after_value = self._compact_scalar(mutation.get("after"))
            if after_value is not None:
                compact_mutation["after"] = after_value
            compacted.append({key: value for key, value in compact_mutation.items() if value not in (None, "", [])})
            if len(compacted) >= max_items:
                break
        return compacted

    def _compact_lore_entries(self, entries: Any) -> list[dict[str, Any]]:
        compacted: list[dict[str, Any]] = []
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict):
                continue
            compacted.append(
                {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "entry_type": entry.get("entry_type"),
                    "content": self._trim_text(entry.get("content"), limit=self.MAX_PROMPT_LORE_CHARS),
                    "match_reasons": [self._trim_text(reason, limit=80) for reason in (entry.get("match_reasons") or [])[:4]],
                    "constant": bool(entry.get("constant")),
                }
            )
        return compacted

    def _trim_text(self, value: Any, *, limit: int) -> str | None:
        text = str(value or "").strip()
        if not text:
            return None
        if len(text) <= limit:
            return text
        return f"{text[:limit].rstrip()}..."

    def _compact_scalar(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (int, float, bool)):
            return value
        if isinstance(value, str):
            return self._trim_text(value, limit=80)
        if isinstance(value, list):
            compact_list = [self._compact_scalar(item) for item in value[:4]]
            return [item for item in compact_list if item is not None]
        if isinstance(value, dict):
            compact_dict: dict[str, Any] = {}
            for key in list(value.keys())[:4]:
                compact_value = self._compact_scalar(value.get(key))
                if compact_value is not None:
                    compact_dict[str(key)] = compact_value
            return compact_dict
        return self._trim_text(value, limit=80)
