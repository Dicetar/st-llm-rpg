# Separate reusable Records from live campaign entries

Items and Abilities are reusable Records; ownership, equipment, learning, preparation, and scene placement are separate Possession, Learned Ability, and Scene Presence entries. Actors are referenced by stable ID in directed Relationships. This costs a few explicit link types but prevents descriptions, ownership, quantities, relationships, and scene state from becoming one ambiguous generic record, and it makes colocated “choose existing or create new” workflows possible without duplication.
