-- export.applescript
-- Export and screenshot script

-- Screenshot a single slide
on screenshotSlide(docName, slideNumber, outputPath, imageFormat, quality)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set targetSlide to slide slideNumber of targetDoc

        -- Set export format
        if imageFormat is "jpg" or imageFormat is "jpeg" then
            set exportFormat to JPEG
        else
            set exportFormat to PNG
        end if

        -- Export slide as image
        set outputFile to POSIX file outputPath
        export targetSlide to outputFile as exportFormat

        return true
    end tell
end screenshotSlide

-- Screenshot all slides
on screenshotAllSlides(docName, outputDir, imageFormat, quality)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set slideCount to count of slides of targetDoc
        set exportedFiles to {}

        -- Set export format
        if imageFormat is "jpg" or imageFormat is "jpeg" then
            set exportFormat to JPEG
            set fileExtension to ".jpg"
        else
            set exportFormat to PNG
            set fileExtension to ".png"
        end if

        -- Export slides one by one
        repeat with i from 1 to slideCount
            set targetSlide to slide i of targetDoc
            set fileName to "slide_" & (i as string) & fileExtension
            set outputPath to outputDir & "/" & fileName
            set outputFile to POSIX file outputPath

            export targetSlide to outputFile as exportFormat
            set end of exportedFiles to outputPath
        end repeat

        return exportedFiles
    end tell
end screenshotAllSlides

-- Export presentation as PDF
on exportPDF(docName, outputPath, slideRange)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set outputFile to POSIX file outputPath

        if slideRange is "" then
            -- Export all slides
            export targetDoc to outputFile as PDF
        else
            -- Export specified slide range
            -- Note: Keynote may not directly support range export; basic implementation here
            export targetDoc to outputFile as PDF
        end if

        return true
    end tell
end exportPDF

-- Export presentation as image sequence
on exportImages(docName, outputDir, imageFormat, quality)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        -- Set export format
        if imageFormat is "jpg" or imageFormat is "jpeg" then
            set exportFormat to JPEG
        else
            set exportFormat to PNG
        end if

        -- Export all slides
        set outputFolder to POSIX file outputDir
        export targetDoc to outputFolder as exportFormat

        return true
    end tell
end exportImages

-- Export presentation as PowerPoint format
on exportPowerPoint(docName, outputPath)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set outputFile to POSIX file outputPath
        export targetDoc to outputFile as Microsoft PowerPoint

        return true
    end tell
end exportPowerPoint

-- Export presentation as QuickTime movie
on exportMovie(docName, outputPath, movieFormat, quality)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set outputFile to POSIX file outputPath

        -- Set movie format
        if movieFormat is "mov" then
            set exportFormat to QuickTime movie
        else
            set exportFormat to QuickTime movie
        end if

        -- Export as movie
        export targetDoc to outputFile as exportFormat

        return true
    end tell
end exportMovie

-- Export presentation as HTML
on exportHTML(docName, outputPath)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set outputFile to POSIX file outputPath
        export targetDoc to outputFile as HTML

        return true
    end tell
end exportHTML

-- Print presentation
on printPresentation(docName, printerName, slideRange)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        -- Basic print functionality
        if printerName is not "" then
            -- Set printer (if specified)
            tell application "System Events"
                tell process "Keynote"
                    keystroke "p" using command down
                    delay 1
                    -- Additional print settings can be added here
                end tell
            end tell
        else
            print targetDoc
        end if

        return true
    end tell
end printPresentation

-- Get export options
on getExportOptions()
    set exportOptions to {}

    -- Supported image formats
    set imageFormats to {"PNG", "JPEG", "TIFF", "GIF"}
    set end of exportOptions to imageFormats

    -- Supported document formats
    set documentFormats to {"PDF", "PowerPoint", "HTML", "QuickTime"}
    set end of exportOptions to documentFormats

    -- Quality options
    set qualityOptions to {"Low", "Medium", "High", "Maximum"}
    set end of exportOptions to qualityOptions

    return exportOptions
end getExportOptions

-- Batch export multiple presentations
on batchExport(docNames, outputDir, exportFormat, quality)
    set exportedFiles to {}

    repeat with docName in docNames
        try
            tell application "Keynote"
                set targetDoc to document docName

                if exportFormat is "PDF" then
                    set fileName to (name of targetDoc) & ".pdf"
                    set outputPath to outputDir & "/" & fileName
                    set outputFile to POSIX file outputPath
                    export targetDoc to outputFile as PDF

                else if exportFormat is "PNG" then
                    set fileName to (name of targetDoc) & ".png"
                    set outputPath to outputDir & "/" & fileName
                    set outputFile to POSIX file outputPath
                    export targetDoc to outputFile as PNG

                else if exportFormat is "JPEG" then
                    set fileName to (name of targetDoc) & ".jpg"
                    set outputPath to outputDir & "/" & fileName
                    set outputFile to POSIX file outputPath
                    export targetDoc to outputFile as JPEG

                end if

                set end of exportedFiles to outputPath
            end tell
        on error errorMessage
            log "Error exporting " & docName & ": " & errorMessage
        end try
    end repeat

    return exportedFiles
end batchExport

-- Get slide preview
on getSlidePreview(docName, slideNumber, previewSize)
    tell application "Keynote"
        if docName is "" then
            set targetDoc to front document
        else
            set targetDoc to document docName
        end if

        set targetSlide to slide slideNumber of targetDoc

        -- Create temporary preview file
        set tempDir to (path to temporary items folder) as string
        set tempFile to tempDir & "slide_preview_" & (slideNumber as string) & ".png"
        set tempPath to POSIX file tempFile

        -- Export preview
        export targetSlide to tempPath as PNG

        return tempFile
    end tell
end getSlidePreview