
import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

if not API_KEY:
    raise RuntimeError("GEMINI_API_KEY is missing from .env")

client = genai.Client(api_key=API_KEY)


def generate_study_material(extracted_text: str) -> dict:
    if not extracted_text or not extracted_text.strip():
        raise ValueError("The document contains no text.")

    # Keep the first version manageable.
    source_text = extracted_text[:25000]

    prompt = f"""
You are Quiz Craft, an educational study assistant.

Use ONLY the supplied study material. Do not invent facts.
If the material does not support a detail, do not include it.

Create:
1. A clear summary of the material.
2. Five multiple-choice questions.
3. Four options for every question.
4. The correct answer as an integer from 0 to 3.
5. A short explanation for each correct answer.

Return valid JSON with this exact structure:
{{
  "summary": "Summary text",
  "key_points": ["Point 1", "Point 2"],
  "questions": [
    {{
      "question": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": 0,
      "explanation": "Explanation based on the source"
    }}
  ]
}}

Study material:
---
{source_text}
---
"""

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )

    if not response.text:
        raise RuntimeError("Gemini returned an empty response.")

    result = json.loads(response.text)

    if not isinstance(result.get("summary"), str):
        raise ValueError("Gemini returned an invalid summary.")

    if not isinstance(result.get("questions"), list):
        raise ValueError("Gemini returned invalid questions.")

    for question in result["questions"]:
        if (
            not isinstance(question.get("question"), str)
            or not isinstance(question.get("options"), list)
            or len(question["options"]) != 4
            or not isinstance(question.get("correct_answer"), int)
            or isinstance(question.get("correct_answer"), bool)
            or not 0 <= question["correct_answer"] <= 3
            or not isinstance(question.get("explanation"), str)
        ):
            raise ValueError("Gemini returned an invalid MCQ.")

    return result
