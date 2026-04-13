"""
backend/diagnostic_engine.py

Diagnostic engine using Gemini to match student mistakes to knowledge graph concepts.
"""

import os
import json
import sqlite3
from google import genai
from google.genai import types

# We will initialize the client dynamically inside the function


def fetch_all_nodes(db_path: str = "math_graph.db") -> list[dict]:
    """
    Connect to the local SQLite database and return a list of all nodes.
    
    Returns:
        A list of dictionaries containing concept_code, concept_name_vn,
        and concept_description.
    """
    if not os.path.exists(db_path):
        # Graceful fallback if SQLite database doesn't exist yet
        # Returning empty allows the system to not fail outright, though the prompt will be empty.
        return []
        
    conn = sqlite3.connect(db_path)
    # Set row_factory to get dict-like rows
    conn.row_factory = sqlite3.Row
    
    try:
        cursor = conn.cursor()
        # Querying specific columns requested in the prompt
        cursor.execute("SELECT concept_code, concept_name_vn, concept_description FROM nodes")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

async def match_error_to_concept(problem: str, student_mistake: str, target_concept_code: str) -> dict:
    """
    Uses Gemini to match a student's described mistake to the exact concept_code
    that represents the foundational knowledge gap.
    
    Returns a dictionary matching the required JSON schema:
    {'matched_concept_code': 'string', 'explanation': 'string'}
    """
    nodes = fetch_all_nodes()
    
    # Form a string of available concept codes and their descriptions
    concepts_str_lines = []
    for node in nodes:
        code = node.get("concept_code")
        name = node.get("concept_name_vn", "")
        desc = node.get("concept_description", "")
        concepts_str_lines.append(f"- Code: {code} | Name: {name} | Description: {desc}")
    
    valid_concepts_str = "\n".join(concepts_str_lines)
    
    prompt = (
        "You are an expert diagnostic mapper. I will give you a math problem, "
        "the exact mistake a student made, and a list of valid concept codes with their descriptions. "
        "You must match the student's mistake to the MOST ACCURATE concept code from the list "
        "that represents the foundational knowledge gap.\n\n"
        f"MATH PROBLEM:\n{problem}\n\n"
        f"STUDENT MISTAKE:\n{student_mistake}\n\n"
        f"TARGET CONCEPT CODE IF KNOWN: {target_concept_code}\n\n"
        "VALID CONCEPT CODES:\n"
        f"{valid_concepts_str}\n\n"
        "RESPOND ONLY WITH A VALID JSON matching this exact schema: \n"
        "{\n"
        "  'matched_concept_code': 'string (the exact code from the valid list)',\n"
        "  'explanation': 'string (a concise pedagogical explanation of the diagnosis)'\n"
        "}."
    )
    
    api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key) if api_key else genai.Client()
    
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        thinking_config=types.ThinkingConfig(include_thoughts=True)
    )

    # Use the asynchronous aio client in the new SDK
    response = await client.aio.models.generate_content(
        model="gemini-3-flash-preview",
        contents=prompt,
        config=config
    )
    
    thinking_logs = []
    final_json_text = ""
    
    # Process the response parts to extract the Native Thinking Trace
    if response.candidates and response.candidates[0].content.parts:
        for part in response.candidates[0].content.parts:
            if getattr(part, "thought", False):
                thinking_logs.append(part.text)
            else:
                final_json_text += part.text
    else:
        final_json_text = response.text
        
    try:
        result_json = json.loads(final_json_text)
        if thinking_logs:
            result_json["thinking_log"] = "\n\n".join(thinking_logs)
        return result_json
    except json.JSONDecodeError as e:
        return {
            "matched_concept_code": None,
            "explanation": f"Failed to parse Gemini response as JSON. Error: {str(e)}\nRaw Response: {final_json_text}"
        }
