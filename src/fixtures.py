"""Real rows from Cooking data (read 2026-11-11), trimmed to what the click test needs."""
RAW = {
 "Recipes": [
  ["ID","Name","Japanese","Version","Unit","Unit plural","Default servings","Style","Why it works","Source","Equipment","What changed in this version","Status"],
  ["OKO","Okonomiyaki","お好み焼き 豚玉 (buta-tama)","2","pancake","pancakes","4","Kansai (Osaka) mixed style, cooked thin.","Cabbage first, batter second.","Okonomiyaki Kiji, Osaka.","Flat griddle\n2 flat okonomiyaki spatulas (hera)","From cook 1: small fillings doubled.","Dialing in"]],
 "Ingredients": [
  ["Recipe","Order","Group","Item","Look for","Per serving","Unit","Prep","Pantry ID","Why (detail)","Note"],
  ["OKO","1","Dashi liquid","Dashi (made from a pack)","Kaneshichi dashi pack","60","ml","Made in prep step 1.","P06","The batter's liquid is seasoned stock.",""],
  ["OKO","4","Batter","Soft wheat flour","薄力粉 / 日清フラワー","40","g","Weigh it.","P15","Low-protein flour.",""],
  ["OKO","7","Batter","Egg, whole","","1","egg","White and yolk go in the batter.","P18","Binds the cabbage.",""],
  ["OKO","8","Fillings","Cabbage","","150","g","Shred 2 to 3 mm.","P16","The body of the dish.",""],
  ["OKO","14","On top while cooking","Pork belly, thin-sliced","豚バラ スライス","75","g","Cut slices to about 5 cm.","P03","Belly's fat renders.","v2: was 50 g loin"],
  ["OKO","16","Finish","Okonomi sauce","お好みソース, Otafuku","1","Tbsp","Mixed 3 to 1.","P12","Sweet and tangy.","starting amount; brush to taste"]],
 "Steps": [
  ["Recipe","Phase","Order","Step","Detail","Timer (min)","Glossary","Ingredients"],
  ["OKO","Prep","3","Shred the cabbage and weigh each pancake's share into its own bowl.","Stack, roll, slice.","","sengiri","8"],
  ["OKO","Cook","5","Cook side 1 uncovered, about 4 minutes.","Lift an edge at 3 minutes.","4","",""]],
 "Pantry": [
  ["#","Item","Look for (Japanese)","What I bought (2026-10-28)","Where in Nijiya","Price (shelf tag or receipt label)","Notes","Recipes","Pantry ID","Section","Buy by","Keep"],
  ["3","Pork belly, thin-sliced","豚バラ スライス","Bought PORK LOIN by mistake","Meat case","$7.79","Next time get 豚バラ","Okonomiyaki","P03","Meat","amount","Fridge"],
  ["6","Dashi packs","天然だしの素パック","Kaneshichi","Dashi aisle","$10.99","","Okonomiyaki","P06","Dry goods","stock","Fridge after opening"],
  ["12","Okonomi sauce","お好みソース","Otafuku, 500 g","Sauce aisle","","","Okonomiyaki","P12","Sauces and seasonings","stock","Fridge after opening"],
  ["15","Soft wheat flour","薄力粉 / 日清フラワー","Nisshin Flour","Flour shelf","$4.49","","Okonomiyaki","P15","Dry goods","stock","Pantry"],
  ["Home","Cabbage","","Green cabbage","Any grocery","","About 1/3 head per 2 pancakes.","Okonomiyaki","P16","Produce","amount","Fridge"],
  ["Home","Eggs","","Large","Any grocery","","","Okonomiyaki","P18","Refrigerated and pickles","amount","Fridge"]],
 "Glossary": [
  ["Term","Japanese","Kind","Meaning"],
  ["sengiri","千切り","Cut","Fine shreds, about 2 to 3 mm wide."]],
 "Cooks": [
  ["Date","Recipe","Cook #","What I changed from last time","What happened (taste / texture / timing)","Her reaction","My score (1-5)","Next time try","Recipe ID"],
  ["2026-10-30","Okonomiyaki v1.1","1 (pancake 1)","First cook.","4 min a side; golden.","Liked it.","","Spread thinner.","OKO"],
  ["2026-10-30","Okonomiyaki v1.1","1 (pancake 2)","Cooked longer.","Not wet in the middle.","Not recorded separately.","4","Cook 2: pork belly.","OKO"],
  ["2026-11-01","Okonomiyaki v2","2 (scrapped)","Cooked away from home.","Scrapped.","","","","OKO"],
  ["2026-11-03","Okonomiyaki v2","3","","The pork loin is too thick","Very good","4","Pork belly","OKO"]]
}
SECTIONS = [{"Section": s, "Order": i + 1, "Aliases": a} for i, (s, a) in enumerate([
  ("Produce", "Produce"), ("Meat & seafood", "Meat"), ("Dairy & eggs", ""), ("Deli & fridge", "Refrigerated and pickles"),
  ("Dry goods", "Dry goods, Home staples"), ("Sauces & seasonings", "Sauces and seasonings"), ("Frozen", ""), ("Bakery", ""),
  ("Drinks", ""), ("Household", "")])]
