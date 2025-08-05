# %% Function definitions
from beholder import sample_london_location, sample_multiple_locations, sample_batch_locations
from IPython.display import display
from PIL import Image
import os
from dotenv import load_dotenv

load_dotenv()

def check_api_keys():
    """Check which API keys are configured."""
    print("🔑 API Key Status:")
    print("=" * 40)
    
    # Check Google Maps API
    gmaps_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if gmaps_key:
        print(f"✅ GOOGLE_MAPS_API_KEY: Set (ends with ...{gmaps_key[-8:]})")
    else:
        print(f"❌ GOOGLE_MAPS_API_KEY: Not set")
    
    # Check Gemini API  
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        print(f"✅ GEMINI_API_KEY: Set (ends with ...{gemini_key[-8:]})")
    else:
        print(f"❌ GEMINI_API_KEY: Not set")
        print(f"   Get from: https://aistudio.google.com/")
        print(f"   Add to .env: GEMINI_API_KEY=your_key_here")
    
    return bool(gmaps_key), bool(gemini_key)

def test_single_location_with_ai():
    """Sample a single location, show image inline, and display AI rating."""
    print("🎯 Testing single location with AI aesthetic evaluation...")
    print("=" * 70)
    
    try:
        # Sample with AI evaluation
        location = sample_london_location(
            evaluate_aesthetics=True, 
            verbose=True,
            optimize_viewpoint=True,
            outdoor_only=True
        )
        
        if location and location.get('image_path'):
            print(f"\n📸 DISPLAYING RESULTS:")
            print(f"🏠 Address: {location['address']}")
            print(f"📍 Coordinates: ({location['latitude']:.6f}, {location['longitude']:.6f})")
            
            # Display image inline
            img = Image.open(location['image_path'])
            display(img)
            
            # Show AI evaluation
            if location.get('beauty_score'):
                print(f"\n⭐ BEAUTY SCORE: {location['beauty_score']}/10")
                print(f"📝 AI REVIEW:")
                review = location.get('aesthetic_review', 'N/A')
                # Wrap text nicely
                words = review.split()
                lines = []
                current_line = []
                for word in words:
                    if len(' '.join(current_line + [word])) <= 70:
                        current_line.append(word)
                    else:
                        if current_line:
                            lines.append(' '.join(current_line))
                        current_line = [word]
                if current_line:
                    lines.append(' '.join(current_line))
                
                for line in lines:
                    print(f"   {line}")
            else:
                print(f"\n❌ No AI rating available")
                if location.get('aesthetic_error'):
                    print(f"   Error: {location['aesthetic_error']}")
        else:
            print("❌ Failed to get location or image")
            
    except Exception as e:
        print(f"❌ Error: {e}")

def batch_ai_evaluation(count=3):
    """Sample multiple locations and evaluate their aesthetic beauty with inline image display."""
    print(f"🎯 Sampling {count} locations with AI aesthetic evaluation...")
    print("=" * 70)
    
    try:
        # Sample locations with AI evaluation
        locations = sample_multiple_locations(
            count, 
            evaluate_aesthetics=True, 
            verbose=False,
            optimize_viewpoint=True,
            outdoor_only=True
        )
        
        print(f"\n📊 BATCH RESULTS ({len(locations)} locations):")
        print("=" * 70)
        
        total_score = 0
        valid_scores = 0
        
        for i, loc in enumerate(locations, 1):
            if loc:
                print(f"\n{'='*60}")
                print(f"LOCATION {i}: {loc['address']}")
                print(f"📍 Coordinates: ({loc['latitude']:.6f}, {loc['longitude']:.6f})")
                
                # Display image inline
                if loc.get('image_path'):
                    img = Image.open(loc['image_path'])
                    display(img)
                
                # Show AI evaluation
                if loc.get('beauty_score'):
                    print(f"\n⭐ BEAUTY SCORE: {loc['beauty_score']}/10")
                    print(f"📝 AI REVIEW:")
                    review = loc.get('aesthetic_review', 'N/A')
                    # Wrap text nicely
                    words = review.split()
                    lines = []
                    current_line = []
                    for word in words:
                        if len(' '.join(current_line + [word])) <= 70:
                            current_line.append(word)
                        else:
                            if current_line:
                                lines.append(' '.join(current_line))
                            current_line = [word]
                    if current_line:
                        lines.append(' '.join(current_line))
                    
                    for line in lines:
                        print(f"   {line}")
                    
                    total_score += loc['beauty_score']
                    valid_scores += 1
                else:
                    print(f"\n❌ No beauty score available")
                    if loc.get('aesthetic_error'):
                        print(f"   Error: {loc['aesthetic_error']}")
                
                # Pause between locations (except last one)
                if i < len(locations):
                    input(f"\n🔄 Press Enter to continue to location {i+1}...")
        
        # Calculate average beauty score
        print(f"\n{'='*70}")
        print(f"🎯 FINAL SUMMARY:")
        if valid_scores > 0:
            avg_score = total_score / valid_scores
            print(f"📊 Average Beauty Score: {avg_score:.1f}/10")
            print(f"✅ Successfully evaluated: {valid_scores}/{len(locations)} locations")
        else:
            print(f"❌ No locations successfully evaluated")
            
    except Exception as e:
        print(f"❌ Error in batch evaluation: {e}")

def estimate_evaluation_costs():
    """Estimate costs for evaluating different numbers of locations."""
    try:
        from beholder.aesthetic_evaluation import get_aesthetic_evaluator
        
        evaluator = get_aesthetic_evaluator()
        
        print("💰 COST ESTIMATION FOR AESTHETIC EVALUATION")
        print("=" * 60)
        print("Using Gemini 2.5 Flash pricing:")
        
        for num_images in [10, 50, 100, 500, 1000]:
            cost_info = evaluator.estimate_cost(num_images)
            total_cost = cost_info['estimated_total_cost']
            cost_per_image = cost_info['cost_per_image']
            
            print(f"  {num_images:4d} images: ${total_cost:.3f} total (${cost_per_image:.4f} per image)")
        
        print("\n💡 Note: These are estimates. Actual costs may vary based on:")
        print("   - Actual image sizes and prompt lengths")
        print("   - Response lengths from Gemini")
        print("   - Current API pricing")
        
    except Exception as e:
        print(f"❌ Error estimating costs: {e}")

# %% Run full test
print("🏗️ LONDON BEAUTY HEATMAP SYSTEM TEST")
print("="*50)

# Check API keys
check_api_keys()
print()

# Test single location with AI
test_single_location_with_ai()