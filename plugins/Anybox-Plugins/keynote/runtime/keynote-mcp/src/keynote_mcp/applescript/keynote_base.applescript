-- keynote_base.applescript
-- Basic Keynote operations script

-- Check if Keynote is running
on checkKeynoteRunning()
    tell application "System Events"
        return (name of processes) contains "Keynote"
    end tell
end checkKeynoteRunning

-- Launch Keynote
on launchKeynote()
    tell application "Keynote"
        activate
    end tell
end launchKeynote

-- Quit Keynote
on quitKeynote()
    tell application "Keynote"
        quit
    end tell
end quitKeynote

-- Get Keynote version
on getKeynoteVersion()
    tell application "Keynote"
        return version
    end tell
end getKeynoteVersion

-- Get current active document
on getCurrentDocument()
    tell application "Keynote"
        if (count of documents) > 0 then
            return front document
        else
            return missing value
        end if
    end tell
end getCurrentDocument

-- Check if document exists
on documentExists(docName)
    tell application "Keynote"
        try
            set targetDoc to document docName
            return true
        on error
            return false
        end try
    end tell
end documentExists

-- Get list of all open documents
on getOpenDocuments()
    tell application "Keynote"
        set docList to {}
        repeat with doc in documents
            set end of docList to name of doc
        end repeat
        return docList
    end tell
end getOpenDocuments

-- Activate specified document
on activateDocument(docName)
    tell application "Keynote"
        set front document to document docName
    end tell
end activateDocument 