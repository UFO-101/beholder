"""Aesthetic evaluation using Gemini 2.5 Flash for London Street View images."""

import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import google.generativeai as genai
from dotenv import load_dotenv
from PIL import Image

load_dotenv()


class AestheticEvaluator:
    """Evaluates the aesthetic quality of Street View images using Gemini 2.5 Flash."""

    def __init__(self, api_key: Optional[str] = None):
        """Initialize the aesthetic evaluator.

        Args:
            api_key: Gemini API key. If None, will try to get from environment
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")

        # Configure Gemini
        genai.configure(api_key=self.api_key)
        self.model = genai.GenerativeModel("gemini-2.5-flash")

    def create_evaluation_prompt(self, address: str) -> str:
        """Create the prompt for aesthetic evaluation.

        Args:
            address: The address of the location being evaluated

        Returns:
            Formatted evaluation prompt
        """
        return f"""You are an expert architectural and urban design critic evaluating the aesthetic quality of street scenes. 

Analyze this Street View image of {address} and provide:

1. **Aesthetic Review** (2-3 sentences): Describe the architectural style, building condition, street environment, and overall visual appeal. Consider factors like:
   - Architectural quality and style
   - Road and pavement materials can make a surprising difference to the overall aesthetic. Brick or flagstone can greatly improve a street scene compared to concrete or asphalt.
   - Building maintenance and appearance
   - Street cleanliness and landscaping
   - Visual harmony and composition
   - Overall neighborhood character

2. **Beauty Score** (1-10): Rate the overall aesthetic appeal where:
   - 1-2: Bad (ugly, neglected, or visually jarring). Eg. industrial sites, derelict buildings
   - 3-4: Lackluster (bland, uninspiring). Eg. Grim housing blocks, dirty steets
   - 5-6: Okay (pleasant but unremarkable). Eg. Unadorned houses, bland modern developments
   - 7-8: Good (attractive, well-designed). Eg. Ornamented houses, greenery, flagstone paths
   - 9-10: Excellent (beautiful, exquisite, iconic) Eg. Ornate facades, colourful gardens, well composed street scenes

Be fair and open minded, while maintaining high standards. Don't be afraid to use the full range of the scale.

Format your response EXACTLY as:
REVIEW: [Your 2-3 sentence review here]
SCORE: [Single number from 1-10]

Example 1:
REVIEW: A well-maintained Victorian terrace with original period features and attractive brickwork. The street is clean with mature trees providing natural beauty, though some modern additions slightly detract from the historic character.
SCORE: 7

Example 2:
REVIEW: A bland residential block with integrated ground-level garages dominating the streetscape. While appearing adequately maintained, the design lacks visual interest and is devoid of notable aesthetic appeal or landscaping.
SCORE: 2"""

    def analyze_image(
        self, image_path: str, address: str, verbose: bool = False
    ) -> Dict[str, Any]:
        """Analyze a Street View image for aesthetic quality.

        Args:
            image_path: Path to the Street View image
            address: Address of the location
            verbose: If True, print detailed logging

        Returns:
            Dictionary with review, score, and metadata
        """
        try:
            if verbose:
                print(f"🎨 Analyzing aesthetic quality of {address}")

            # Load and validate image
            if not Path(image_path).exists():
                raise FileNotFoundError(f"Image not found: {image_path}")

            image = Image.open(image_path)
            if verbose:
                print(f"   📸 Image loaded: {image.size[0]}x{image.size[1]}")

            # Create evaluation prompt
            prompt = self.create_evaluation_prompt(address)

            # Send to Gemini
            if verbose:
                print(f"   🤖 Sending to Gemini 2.5 Flash...")

            start_time = time.time()
            response = self.model.generate_content([prompt, image])
            analysis_time = time.time() - start_time

            if verbose:
                print(f"   ⚡ Analysis completed in {analysis_time:.2f}s")

            # Parse response
            result = self.parse_response(response.text, verbose)
            result.update(
                {
                    "address": address,
                    "image_path": image_path,
                    "analysis_time": analysis_time,
                    "model": "gemini-2.5-flash",
                }
            )

            if verbose:
                print(f"   ⭐ Beauty score: {result.get('beauty_score', 'N/A')}")
                print(f"   📝 Review: {result.get('aesthetic_review', 'N/A')[:60]}...")

            return result

        except Exception as e:
            error_msg = f"Error analyzing {address}: {str(e)}"
            if verbose:
                print(f"   ❌ {error_msg}")

            return {
                "address": address,
                "image_path": image_path,
                "aesthetic_review": None,
                "beauty_score": None,
                "error": error_msg,
                "analysis_time": None,
                "model": "gemini-2.5-flash",
            }

    def parse_response(
        self, response_text: str, verbose: bool = False
    ) -> Dict[str, Any]:
        """Parse Gemini response to extract review and score.

        Args:
            response_text: Raw response from Gemini
            verbose: If True, print parsing details

        Returns:
            Dictionary with parsed review and score
        """
        try:
            if verbose:
                print(f"   🔍 Parsing response ({len(response_text)} chars)")

            # Extract review (text after "REVIEW:")
            review_match = re.search(
                r"REVIEW:\s*(.+?)(?=SCORE:|$)", response_text, re.DOTALL | re.IGNORECASE
            )
            review = review_match.group(1).strip() if review_match else None

            # Extract score (number after "SCORE:")
            score_match = re.search(
                r"SCORE:\s*(\d+(?:\.\d+)?)", response_text, re.IGNORECASE
            )
            score = None

            if score_match:
                try:
                    score = float(score_match.group(1))
                    # Clamp score to 1-10 range
                    score = max(1.0, min(10.0, score))
                except ValueError:
                    pass

            # If structured parsing fails, try to extract any number
            if score is None:
                number_matches = re.findall(r"\b(\d+(?:\.\d+)?)\b", response_text)
                for match in number_matches:
                    try:
                        candidate = float(match)
                        if 1.0 <= candidate <= 10.0:
                            score = candidate
                            break
                    except ValueError:
                        continue

            if verbose:
                print(
                    f"   ✅ Parsed - Review: {'Found' if review else 'Not found'}, Score: {score}"
                )

            return {
                "aesthetic_review": review,
                "beauty_score": score,
                "raw_response": response_text,
                "parsing_successful": review is not None and score is not None,
            }

        except Exception as e:
            if verbose:
                print(f"   ❌ Parsing error: {e}")

            return {
                "aesthetic_review": None,
                "beauty_score": None,
                "raw_response": response_text,
                "parsing_successful": False,
                "parsing_error": str(e),
            }

    def batch_analyze(
        self,
        locations: List[Dict[str, Any]],
        verbose: bool = False,
        delay_seconds: float = 0.1,
    ) -> List[Dict[str, Any]]:
        """Analyze multiple locations in batch.

        Args:
            locations: List of location dictionaries with image_path and address
            verbose: If True, print progress information
            delay_seconds: Delay between API calls to avoid rate limiting

        Returns:
            List of analysis results
        """
        results = []
        total = len(locations)

        if verbose:
            print(f"🎨 Starting batch analysis of {total} locations")

        for i, location in enumerate(locations, 1):
            if verbose:
                print(f"\n--- Analyzing {i}/{total} ---")

            # Analyze the location
            result = self.analyze_image(
                location["image_path"], location["address"], verbose=verbose
            )

            # Add original location data
            result.update(
                {
                    "place_id": location.get("place_id"),
                    "latitude": location.get("latitude"),
                    "longitude": location.get("longitude"),
                }
            )

            results.append(result)

            # Rate limiting delay
            if i < total and delay_seconds > 0:
                if verbose:
                    print(f"   ⏸️  Waiting {delay_seconds}s...")
                time.sleep(delay_seconds)

        if verbose:
            successful = sum(1 for r in results if r.get("beauty_score") is not None)
            print(f"\n🎉 Batch analysis complete: {successful}/{total} successful")

        return results

    def estimate_cost(self, num_images: int) -> Dict[str, float]:
        """Estimate the cost of analyzing images.

        Args:
            num_images: Number of images to analyze

        Returns:
            Dictionary with cost estimates
        """
        # Gemini 2.5 Flash pricing (as of current data)
        input_cost_per_1m_tokens = 0.30  # $0.30 per 1M input tokens
        output_cost_per_1m_tokens = 2.50  # $2.50 per 1M output tokens

        # Rough estimates
        tokens_per_image = 1300  # ~1300 tokens for 640x640 image
        tokens_per_prompt = 200  # Prompt tokens
        tokens_per_response = 100  # Expected response tokens

        total_input_tokens = num_images * (tokens_per_image + tokens_per_prompt)
        total_output_tokens = num_images * tokens_per_response

        input_cost = (total_input_tokens / 1_000_000) * input_cost_per_1m_tokens
        output_cost = (total_output_tokens / 1_000_000) * output_cost_per_1m_tokens
        total_cost = input_cost + output_cost

        return {
            "num_images": num_images,
            "estimated_input_tokens": total_input_tokens,
            "estimated_output_tokens": total_output_tokens,
            "estimated_input_cost": input_cost,
            "estimated_output_cost": output_cost,
            "estimated_total_cost": total_cost,
            "cost_per_image": total_cost / num_images if num_images > 0 else 0,
        }


def get_aesthetic_evaluator() -> AestheticEvaluator:
    """Get or create a global aesthetic evaluator instance."""
    global _evaluator
    if "_evaluator" not in globals():
        _evaluator = AestheticEvaluator()
    return _evaluator
